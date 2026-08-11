import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const indexPath = path.join(root, "index.html");

const key = (process.env.KAKAO_JAVASCRIPT_KEY || "").replace(/[^A-Za-z0-9]/g, "");

if (key.length < 20) {
  throw new Error("Kakao JavaScript key format looks invalid.");
}

const html = fs.readFileSync(indexPath, "utf8");
const pattern = /kakaoJavaScriptKey:\s*"[^"]*"/;

if (!pattern.test(html)) {
  throw new Error("Cannot find kakaoJavaScriptKey in index.html.");
}

const nextHtml = html.replace(pattern, `kakaoJavaScriptKey: "${key}"`);
fs.writeFileSync(indexPath, nextHtml, "utf8");

console.log(`Updated index.html with Kakao JavaScript key length=${key.length}`);
