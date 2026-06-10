// popup.js
// アイコンを押すと開く。今のタブに scan.js を1回注入 → 判定 → 表示 → 端末内に記録。

// しきい値はここだけ見れば調整できる（7日運用のチューニング用）
const SETTINGS = {
  priceDropRatio: 0.7, // 中央値の何割を下回ったら「安すぎ」とみなすか（0.7 = 30%以上安い）
  sellerNewDays: 30,   // 登録から何日未満を「新規」とみなすか
  minSamples: 5        // 価格判定を有効にする最低サンプル数（同カテゴリ）
};

function verdictText(v) {
  return {
    suspicious: "疑わしい — 確認推奨",
    caution: "やや注意 — 1点ひっかかる",
    ok: "概ね問題なし",
    insufficient: "判定材料が少ない"
  }[v] || "—";
}

function median(a) {
  if (!a.length) return NaN;
  const b = a.slice().sort((x, y) => x - y);
  const m = Math.floor(b.length / 2);
  return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2;
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function scan() {
  const tab = await getActiveTab();
  if (!tab || !/^https?:/.test(tab.url || "")) {
    return { error: "このページでは判定できません（http / https の出品ページで使ってね）。" };
  }

  let listing;
  try {
    const [inj] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["scan.js"] });
    listing = inj && inj.result;
  } catch (e) {
    return { error: "ページを読み取れませんでした：" + (e.message || e) };
  }
  if (!listing) return { error: "出品情報を取得できませんでした。" };

  // 同カテゴリの価格を端末内にためて中央値を出す（スライディング窓・最大100件）
  const key = "median:" + (listing.category || listing.host || "unknown");
  const store = await chrome.storage.local.get(key);
  const arr = (store[key] || []).slice(-99);
  if (isFinite(listing.price) && listing.price > 0) arr.push(listing.price);
  await chrome.storage.local.set({ [key]: arr.slice(-100) });
  const med = median(arr);

  const flags = [];
  const reasons = [];

  // 価格チェック（サンプルが少ないうちは精度が出ないので発火させない）
  if (isFinite(listing.price) && listing.price > 0 && isFinite(med) && arr.length >= SETTINGS.minSamples) {
    if (listing.price < SETTINGS.priceDropRatio * med) {
      flags.push("price_anomaly");
      reasons.push(`価格が安すぎる疑い：${listing.price.toLocaleString()}（このカテゴリの中央値≈${Math.round(med).toLocaleString()}）`);
    }
  }

  // 出品者の新規度
  if (isFinite(listing.seller_age_days) && listing.seller_age_days < SETTINGS.sellerNewDays) {
    flags.push("seller_new");
    reasons.push(`新規アカウントの疑い：登録から約 ${listing.seller_age_days} 日`);
  }

  let verdict;
  if (flags.length >= 2) verdict = "suspicious";
  else if (flags.length === 1) verdict = "caution";
  else if (arr.length < SETTINGS.minSamples && !isFinite(listing.seller_age_days)) verdict = "insufficient";
  else verdict = "ok";

  const rec = {
    event: "scan",
    listing_id: listing.listing_id,
    host: listing.host,
    title: listing.title,
    heuristics: flags,
    verdict,
    ui_version: "0.2.0",
    ts: Date.now(),
    meta: {
      price: isFinite(listing.price) ? listing.price : null,
      median: isFinite(med) ? med : null,
      samples: arr.length,
      seller_age_days: isFinite(listing.seller_age_days) ? listing.seller_age_days : null
    }
  };

  const t = (await chrome.storage.local.get("telemetry")).telemetry || [];
  t.push(rec);
  await chrome.storage.local.set({ telemetry: t.slice(-1000), lastScan: rec, lastListing: listing });

  return { rec, reasons, listing };
}

function render(out) {
  const s = document.getElementById("status");
  const sub = document.getElementById("sub");
  const r = document.getElementById("reasons");
  r.innerHTML = "";

  if (out.error) {
    s.textContent = "—";
    s.className = "v-na";
    sub.textContent = out.error;
    return;
  }

  const v = out.rec.verdict;
  s.textContent = verdictText(v);
  s.className =
    v === "suspicious" ? "v-bad" :
    v === "caution" ? "v-warn" :
    v === "ok" ? "v-ok" : "v-na";
  sub.textContent = out.listing.title || out.listing.host;

  if (out.reasons.length === 0) {
    const tail = out.rec.meta.samples < SETTINGS.minSamples ? "（価格判定はもう少しデータが必要）" : "";
    r.innerHTML = `<li class="muted">ひっかかった項目はなし。${tail}</li>`;
  } else {
    out.reasons.forEach((x) => {
      const li = document.createElement("li");
      li.textContent = x;
      r.appendChild(li);
    });
  }
}

async function exportCsv() {
  const { telemetry } = await chrome.storage.local.get("telemetry");
  const rows = (telemetry || []).map((t) => ({
    ts: new Date(t.ts).toISOString(),
    verdict: t.verdict,
    host: t.host || "",
    title: t.title || "",
    heuristics: (t.heuristics || []).join("|"),
    price: t.meta && t.meta.price != null ? t.meta.price : "",
    median: t.meta && t.meta.median != null ? Math.round(t.meta.median) : "",
    samples: t.meta ? t.meta.samples : "",
    seller_age_days: t.meta && t.meta.seller_age_days != null ? t.meta.seller_age_days : "",
    label: t.label || "",
    listing_id: t.listing_id
  }));
  const header = ["ts", "verdict", "host", "title", "heuristics", "price", "median", "samples", "seller_age_days", "label", "listing_id"];
  const esc = (x) => `"${String(x).replace(/"/g, '""')}"`;
  const csv = [header.join(","), ...rows.map((row) => header.map((k) => esc(row[k])).join(","))].join("\r\n");
  // 先頭に BOM を付けて Excel で日本語が文字化けしないように
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  await chrome.downloads.download({ url, filename: "listing_sentinel.csv" });
}

async function labelFalsePositive() {
  const { lastScan, telemetry } = await chrome.storage.local.get(["lastScan", "telemetry"]);
  if (!lastScan || !telemetry) return;
  for (let i = telemetry.length - 1; i >= 0; i--) {
    if (telemetry[i].listing_id === lastScan.listing_id) {
      telemetry[i].label = "fp";
      break;
    }
  }
  await chrome.storage.local.set({ telemetry });
  const b = document.getElementById("label-fp");
  b.textContent = "記録した";
  b.disabled = true;
}

async function init() {
  render(await scan());

  document.getElementById("rescan").onclick = async () => { render(await scan()); };
  document.getElementById("label-fp").onclick = labelFalsePositive;
  document.getElementById("print").onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL("print.html") });
  document.getElementById("export").onclick = exportCsv;
}

document.addEventListener("DOMContentLoaded", init);
