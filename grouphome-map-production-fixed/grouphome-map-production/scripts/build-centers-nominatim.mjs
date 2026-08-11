import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const sourcePath = path.join(root, "source", "그룹홈_시설현황_520_CODEX.json");
const outputPath = path.join(root, "assets", "sigungu-centers.json");

const raw = JSON.parse(fs.readFileSync(sourcePath, "utf8"));

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

function fixedSigungu(row) {
  const key = `${row["시도"]}|${row["시설명"]}|${row["소재지"]}`;
  const sigungu = row["시군구"] || SIGUNGU_FIXES.get(key) || "";
  return SIGUNGU_TYPOS.get(`${row["시도"]}|${sigungu}`) || sigungu;
}

function queryFor(row) {
  const sido = row["시도"];
  const sigungu = fixedSigungu(row);
  if (!sigungu) return sido;
  if (sigungu.includes(" ")) return `${sido} ${sigungu.replace(/^(서울|부산|대구|인천|광주|대전|울산)\s+/, "")}`;
  return `${sido} ${sigungu}`;
}

const queries = [...new Set(raw.map(queryFor).filter(Boolean))].sort((a, b) =>
  a.localeCompare(b, "ko")
);

const existing = fs.existsSync(outputPath)
  ? JSON.parse(fs.readFileSync(outputPath, "utf8"))
  : {};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function lookup(query) {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");
  url.searchParams.set("countrycodes", "kr");
  url.searchParams.set("q", query);

  const response = await fetch(url, {
    headers: {
      "User-Agent": "KAGHYC-grouphome-map-static-build/1.0",
      "Accept-Language": "ko,en;q=0.8",
    },
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  const results = await response.json();
  if (!results.length) return null;
  return {
    lat: Number(results[0].lat),
    lng: Number(results[0].lon),
    label: results[0].display_name,
    source: "nominatim-admin-center",
  };
}

const centers = { ...existing };
const failures = [];

for (const query of queries) {
  if (centers[query]) continue;
  try {
    const result = await lookup(query);
    if (result) {
      centers[query] = result;
      console.log(`[center] ${query} -> ${result.lat}, ${result.lng}`);
    } else {
      failures.push({ query, reason: "no_result" });
      console.warn(`[center-fail] ${query}: no_result`);
    }
  } catch (error) {
    failures.push({ query, reason: error.message });
    console.warn(`[center-fail] ${query}: ${error.message}`);
  }
  fs.writeFileSync(outputPath, `${JSON.stringify(centers, null, 2)}\n`, "utf8");
  await sleep(1100);
}

if (failures.length) {
  fs.writeFileSync(
    path.join(root, "assets", "sigungu-centers.failures.json"),
    `${JSON.stringify(failures, null, 2)}\n`,
    "utf8"
  );
}

console.log(`Saved ${Object.keys(centers).length} center coordinates to ${outputPath}`);
