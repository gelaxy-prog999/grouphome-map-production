import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const sourcePath = path.join(root, "source", "그룹홈_시설현황_520_CODEX.json");
const prototypePath = path.join(root, "source", "그룹홈맵.html");
const centersPath = path.join(root, "assets", "sigungu-centers.json");
const dataPath = path.join(root, "data.json");
const failuresPath = path.join(root, "geocoding_failures.json");

const shouldGeocode = process.argv.includes("--geocode");
function normalizeRestKey(value) {
  return (value || "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/^KakaoAK\s+/i, "")
    .replace(/[^A-Za-z0-9]/g, "");
}

const restKey = normalizeRestKey(process.env.KAKAO_REST_API_KEY);
const REQUEST_DELAY_MS = 450;
const MAX_FETCH_ATTEMPTS = 4;
const ABORT_AFTER_CONSECUTIVE_TRANSIENT_FAILURES = 3;

const SIDO_CENTERS = {
  "서울특별시": { lat: 37.5665, lng: 126.978 },
  "부산광역시": { lat: 35.1796, lng: 129.0756 },
  "대구광역시": { lat: 35.8714, lng: 128.6014 },
  "인천광역시": { lat: 37.4563, lng: 126.7052 },
  "광주광역시": { lat: 35.1595, lng: 126.8526 },
  "대전광역시": { lat: 36.3504, lng: 127.3845 },
  "울산광역시": { lat: 35.5384, lng: 129.3114 },
  "세종특별자치시": { lat: 36.4801, lng: 127.289 },
  "경기도": { lat: 37.4138, lng: 127.5183 },
  "강원특별자치도": { lat: 37.8228, lng: 128.1555 },
  "충청북도": { lat: 36.6357, lng: 127.4917 },
  "충청남도": { lat: 36.6588, lng: 126.6728 },
  "전북특별자치도": { lat: 35.7175, lng: 127.153 },
  "전라남도": { lat: 34.8161, lng: 126.463 },
  "경상북도": { lat: 36.4919, lng: 128.8889 },
  "경상남도": { lat: 35.4606, lng: 128.2132 },
  "제주특별자치도": { lat: 33.4996, lng: 126.5312 },
};

const SIGUNGU_FIXES = new Map([
  ["경기도|꿈둥지|경기도 덕단이로115, 201동 102호 (중앙하이츠2단지)", "광명시"],
  ["경기도|하누리|경기도 도덕로 56, 101동 604호 (중앙하이츠1단지)", "광명시"],
  ["경기도|사랑둥지|경기도 덕단이로 115, 201동 602호 (중앙하이츠2단지)", "광명시"],
  ["강원특별자치도|금강의집|강원특별자치도 경강로2323번길 10, 1동 102호(포남동, 고려맨션)", "강릉시"],
]);

const SIGUNGU_TYPOS = new Map([
  ["경상남도|친주시", "진주시"],
  ["광주광역시|광역시", "광주 북구"],
]);

function extractConst(text, name) {
  const prefix = `const ${name} = `;
  const start = text.indexOf(prefix);
  if (start === -1) throw new Error(`Cannot find ${name} in prototype`);
  let index = start + prefix.length;
  const first = text[index];
  const closeFor = first === "[" ? "]" : "}";
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (; index < text.length; index += 1) {
    const ch = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === first) depth += 1;
    else if (ch === closeFor) {
      depth -= 1;
      if (depth === 0) return JSON.parse(text.slice(start + prefix.length, index + 1));
    }
  }
  throw new Error(`Cannot parse ${name}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describeFetchError(error) {
  const cause = error.cause;
  if (!cause) return error.message;
  const code = cause.code || cause.name || "network";
  return `${error.message} (${code}: ${cause.message || "no detail"})`;
}

function normalizeAddressQuery(value) {
  return (value || "")
    .replace(/광주광역시\s+광역시/g, "광주광역시")
    .replace(/경상남도\s+친주시/g, "경상남도 진주시")
    .replace(/(\d+)\s*번지\s*/g, "$1 ")
    .replace(/\s+/g, " ")
    .trim();
}

function withoutDetailAddress(value) {
  return normalizeAddressQuery(value)
    .replace(/\([^)]*\)/g, " ")
    .replace(/,\s*\d+\/\d+.*$/g, "")
    .replace(/,\s*\d{2,4}[-/]?\d{0,4}.*$/g, "")
    .replace(/\s+\d{3,4}[-/]\d{2,4}호?.*$/g, "")
    .replace(/\s+\d+(?:,\d+)?층.*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function addressCandidates(facility) {
  const address = normalizeAddressQuery(facility.address);
  const simple = withoutDetailAddress(address);
  const beforeComma = normalizeAddressQuery(address.split(",")[0]);
  const sigungu = facility.sigungu.replace(/^(서울|부산|대구|인천|광주|대전|울산)\s+/, "");
  return unique([
    address,
    simple,
    beforeComma,
    `${facility.sido} ${sigungu} ${simple.replace(`${facility.sido} ${sigungu}`, "").trim()}`.trim(),
  ]);
}

function asNumber(value) {
  if (value === "" || value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function fixedSigungu(row) {
  const key = `${row["시도"]}|${row["시설명"]}|${row["소재지"]}`;
  let sigungu = row["시군구"] || SIGUNGU_FIXES.get(key) || "";
  const typoKey = `${row["시도"]}|${sigungu}`;
  if (SIGUNGU_TYPOS.has(typoKey)) sigungu = SIGUNGU_TYPOS.get(typoKey);
  return sigungu;
}

function centerQuery(sido, sigungu) {
  if (!sigungu) return sido;
  const clean = sigungu.replace(/^(서울|부산|대구|인천|광주|대전|울산)\s+/, "");
  return `${sido} ${clean}`;
}

function centerFor(row, centers) {
  const sido = row["시도"];
  const sigungu = fixedSigungu(row);
  const query = centerQuery(sido, sigungu);
  if (centers[query]) {
    return { ...centers[query], query };
  }
  const sidoCenter = SIDO_CENTERS[sido] || SIDO_CENTERS["서울특별시"];
  return {
    ...sidoCenter,
    query: sido,
    label: `${sido} 중심좌표`,
    source: "sido-center-fallback",
  };
}

function normalizeFacility(row, index, centers) {
  const sigungu = fixedSigungu(row);
  const lat = asNumber(row["위도"]);
  const lng = asNumber(row["경도"]);
  const dataQuality = [];
  const correctionKey = `${row["시도"]}|${row["시설명"]}|${row["소재지"]}`;

  if (!row["시군구"] && SIGUNGU_FIXES.has(correctionKey)) {
    dataQuality.push(`원본 시군구 공란: ${SIGUNGU_FIXES.get(correctionKey)}로 필터 보정`);
  }
  if (`${row["시도"]}|${row["시군구"]}` === "경상남도|친주시") {
    dataQuality.push("원본 시군구 오탈자: 친주시를 진주시로 필터 보정");
  }
  if (row["데이터비고"]) dataQuality.push(row["데이터비고"]);

  const center = centerFor({ ...row, "시군구": sigungu }, centers);
  return {
    id: `gh-${String(index + 1).padStart(3, "0")}`,
    sido: row["시도"],
    sigungu,
    name: row["시설명"],
    englishName: row["영문명"] || "",
    openedDate: row["설치년월일"] || "",
    openedYear: asNumber(row["설치연도"]),
    era: row["시대구분"] || "",
    director: row["시설장"] || "",
    staff: asNumber(row["종사자수"]) ?? 0,
    quota: asNumber(row["정원"]) ?? 0,
    current: asNumber(row["현원"]) ?? 0,
    vacancy: asNumber(row["빈자리"]) ?? 0,
    occupancyRate: asNumber(row["충원율"]) ?? 0,
    childrenPerStaff: asNumber(row["종사자당아동"]),
    address: row["소재지"] || "",
    phone: row["연락처"] || "",
    lat: lat ?? center.lat,
    lng: lng ?? center.lng,
    geocodeStatus: lat != null && lng != null ? "address" : "fallback_sigungu_center",
    geocodeProvider: lat != null && lng != null ? "source-data" : center.source,
    geocodeAddress: lat != null && lng != null ? row["소재지"] : center.label,
    fallbackCenterQuery: center.query,
    dataQuality,
  };
}

async function requestKakaoAddress(address) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_FETCH_ATTEMPTS; attempt += 1) {
    try {
      const url = new URL("https://dapi.kakao.com/v2/local/search/address.json");
      url.searchParams.set("query", address);
      const response = await fetch(url, {
        headers: {
          Authorization: `KakaoAK ${restKey}`,
        },
      });
      if (!response.ok) {
        const body = await response.text();
        const error = new Error(`${response.status} ${response.statusText}: ${body.slice(0, 160)}`);
        error.status = response.status;
        error.fatal = response.status === 401 || response.status === 403;
        error.retryable = response.status === 429 || response.status >= 500;
        throw error;
      }
      const payload = await response.json();
      const doc = payload.documents?.[0];
      if (!doc) return null;
      return {
        lat: Number(doc.y),
        lng: Number(doc.x),
        addressName: doc.address_name || doc.road_address?.address_name || address,
        query: address,
      };
    } catch (error) {
      if (error.status || error.retryable || error.fatal) {
        lastError = error;
      } else {
        lastError = new Error(describeFetchError(error));
        lastError.network = true;
        lastError.retryable = true;
      }
      if (lastError.fatal || !lastError.retryable || attempt === MAX_FETCH_ATTEMPTS) {
        throw lastError;
      }
      console.warn(`[kakao-retry] attempt ${attempt + 1}/${MAX_FETCH_ATTEMPTS}: ${lastError.message}`);
      await sleep(750 * attempt * attempt);
    }
  }
  throw lastError;
}

async function kakaoAddressSearch(facility) {
  const triedQueries = [];
  for (const query of addressCandidates(facility)) {
    triedQueries.push(query);
    const result = await requestKakaoAddress(query);
    if (result) return { ...result, triedQueries };
  }
  return { noResult: true, triedQueries };
}

const source = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
const prototype = fs.readFileSync(prototypePath, "utf8");
const regions = extractConst(prototype, "REG").map((region) => ({
  sido: region.sido,
  short: region.short,
  count: region.count,
  staff: region.staff,
  quota: region.quota,
  current: region.current,
  vacancy: region.quota - region.current,
  occupancyRate: region.quota ? Math.round((region.current / region.quota) * 100) : 0,
  male: region.male,
  female: region.female,
  pre0_3: region.pre0_3,
  pre3_6: region.pre3_6,
  elementary: region.elem,
  unspecified: region.unspecified,
  center: SIDO_CENTERS[region.sido] || null,
}));
const meta = extractConst(prototype, "META");
const centers = fs.existsSync(centersPath)
  ? JSON.parse(fs.readFileSync(centersPath, "utf8"))
  : {};

function loadExistingCoordinateCache() {
  if (!fs.existsSync(dataPath)) return new Map();
  try {
    const existing = JSON.parse(fs.readFileSync(dataPath, "utf8"));
    return new Map(
      (existing.facilities || [])
        .filter((facility) => facility.geocodeStatus === "address" && facility.geocodeProvider === "kakao-local")
        .map((facility) => [facility.id, facility])
    );
  } catch {
    return new Map();
  }
}

const existingCoordinateCache = loadExistingCoordinateCache();
const facilities = source.map((row, index) => {
  const facility = normalizeFacility(row, index, centers);
  const cached = existingCoordinateCache.get(facility.id);
  if (cached) {
    facility.lat = cached.lat;
    facility.lng = cached.lng;
    facility.geocodeStatus = "address";
    facility.geocodeProvider = "kakao-local";
    facility.geocodeAddress = cached.geocodeAddress;
    facility.geocodeQuery = cached.geocodeQuery;
    delete facility.fallbackCenterQuery;
  }
  return facility;
});
const failures = [];

function writeCheckpoint() {
  const output = {
    generatedAt: new Date().toISOString(),
    source: {
      title: "\ubcf4\uac74\ubcf5\uc9c0\ubd80 2025 \uc544\ub3d9\ubcf5\uc9c0\uc2dc\uc124 \ud604\ud669\u2161",
      "\uae30\uc900\uc77c": "2024-12-31",
      note: "\uc131\ubcc4\u00b7\uc5f0\ub839 \uad6c\ubd84\uc740 \uc2dc\ub3c4 \ub2e8\uc704 \uacf5\uc2dd \ud1b5\uacc4\ub85c\ub9cc \uc81c\uacf5\ub418\uc5b4 regions\uc5d0\ub9cc \ud3ec\ud568\ud569\ub2c8\ub2e4.",
    },
    geocoding: {
      provider: shouldGeocode ? "kakao-local" : "not-run",
      totalFacilities: facilities.length,
      addressCoordinates: facilities.filter((f) => f.geocodeStatus === "address").length,
      fallbackCoordinates: facilities.filter((f) => f.geocodeStatus !== "address").length,
      failuresFile: "geocoding_failures.json",
    },
    meta,
    regions,
    facilities,
  };

  fs.writeFileSync(dataPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  fs.writeFileSync(failuresPath, `${JSON.stringify(failures, null, 2)}\n`, "utf8");
}

if (shouldGeocode && !restKey) {
  throw new Error("KAKAO_REST_API_KEY is required when running with --geocode.");
}

if (shouldGeocode) {
  console.log(`[kakao-key] sanitized length=${restKey.length}`);
  if (!/^[A-Za-z0-9]{30,80}$/.test(restKey)) {
    throw new Error(
      "KAKAO_REST_API_KEY format looks invalid. Copy only the Kakao REST API key value, without labels or extra text."
    );
  }
}

if (shouldGeocode) {
  let consecutiveTransientFailures = 0;
  for (const facility of facilities) {
    if (facility.geocodeStatus === "address" && facility.geocodeProvider === "kakao-local") {
      continue;
    }
    try {
      const result = await kakaoAddressSearch(facility);
      if (!result.noResult) {
        facility.lat = result.lat;
        facility.lng = result.lng;
        facility.geocodeStatus = "address";
        facility.geocodeProvider = "kakao-local";
        facility.geocodeAddress = result.addressName;
        facility.geocodeQuery = result.query;
        delete facility.fallbackCenterQuery;
        consecutiveTransientFailures = 0;
        console.log(`[kakao] ${facility.id} ${facility.name} -> ${result.lat}, ${result.lng}`);
      } else {
        failures.push({
          id: facility.id,
          name: facility.name,
          sido: facility.sido,
          sigungu: facility.sigungu,
          address: facility.address,
          reason: "Kakao Local API returned no address result",
          triedQueries: result.triedQueries,
          fallbackCenterQuery: facility.fallbackCenterQuery,
          fallbackLat: facility.lat,
          fallbackLng: facility.lng,
        });
        consecutiveTransientFailures = 0;
        console.warn(`[kakao-fail] ${facility.id} ${facility.name}: no_result`);
      }
    } catch (error) {
      const failure = {
        id: facility.id,
        name: facility.name,
        sido: facility.sido,
        sigungu: facility.sigungu,
        address: facility.address,
        reason: error.message,
        fallbackCenterQuery: facility.fallbackCenterQuery,
        fallbackLat: facility.lat,
        fallbackLng: facility.lng,
      };
      failures.push(failure);
      console.warn(`[kakao-fail] ${facility.id} ${facility.name}: ${error.message}`);
      if (error.network || error.retryable) {
        consecutiveTransientFailures += 1;
      } else {
        consecutiveTransientFailures = 0;
      }
      if (error.fatal) {
        writeCheckpoint();
        if (/disabled\s+OPEN_MAP_AND_LOCAL/i.test(error.message)) {
          throw new Error(
            "Kakao Map/Local API is disabled for this app. In Kakao Developers, open [My Application] > [Kakao Map] > [Usage settings] and set [State] to ON."
          );
        }
        throw new Error(
          "Kakao Local API authentication failed. Check that you entered the REST API key, not the JavaScript key."
        );
      }
      if (consecutiveTransientFailures >= ABORT_AFTER_CONSECUTIVE_TRANSIENT_FAILURES) {
        writeCheckpoint();
        throw new Error(
          "Kakao Local API connection failed repeatedly. Progress was saved; wait a minute and run geocode-windows.cmd again."
        );
      }
    }
    if (Number(facility.id.replace("gh-", "")) % 25 === 0) {
      writeCheckpoint();
    }
    await sleep(REQUEST_DELAY_MS);
  }
} else {
  for (const facility of facilities) {
    if (facility.geocodeStatus !== "address") {
      failures.push({
        id: facility.id,
        name: facility.name,
        sido: facility.sido,
        sigungu: facility.sigungu,
        address: facility.address,
        reason: "KAKAO_REST_API_KEY not provided; Kakao batch geocoding not run",
        fallbackCenterQuery: facility.fallbackCenterQuery,
        fallbackLat: facility.lat,
        fallbackLng: facility.lng,
      });
    }
  }
}

const output = {
  generatedAt: new Date().toISOString(),
  source: {
    title: "보건복지부 2025 아동복지시설 현황Ⅱ",
    기준일: "2024-12-31",
    note: "성별·연령 구분은 시도 단위 공식 통계로만 제공되어 regions에만 포함합니다.",
  },
  geocoding: {
    provider: shouldGeocode ? "kakao-local" : "not-run",
    totalFacilities: facilities.length,
    addressCoordinates: facilities.filter((f) => f.geocodeStatus === "address").length,
    fallbackCoordinates: facilities.filter((f) => f.geocodeStatus !== "address").length,
    failuresFile: "geocoding_failures.json",
  },
  meta,
  regions,
  facilities,
};

fs.writeFileSync(dataPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
fs.writeFileSync(failuresPath, `${JSON.stringify(failures, null, 2)}\n`, "utf8");

console.log(`Wrote ${facilities.length} facilities to ${dataPath}`);
console.log(`Geocoding failures/fallbacks: ${failures.length} -> ${failuresPath}`);
