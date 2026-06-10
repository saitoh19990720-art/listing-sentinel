// print.js — 直近の判定を A4 1枚にして印刷ダイアログを開く
(async function () {
  const { lastScan, lastListing } = await chrome.storage.local.get(["lastScan", "lastListing"]);
  const el = document.getElementById("block");

  if (!lastScan) {
    el.textContent = "まだ判定データがありません。先に拡張アイコンから出品ページを判定してください。";
    return;
  }

  const escapeHtml = (s) =>
    String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const fmt = (n) => (typeof n === "number" && isFinite(n) ? n.toLocaleString() : "?");
  const row = (k, v) => `<div class="row"><span class="k">${k}</span><span class="val">${v}</span></div>`;

  const vlabel = {
    suspicious: "疑わしい — 確認推奨",
    caution: "やや注意",
    ok: "概ね問題なし",
    insufficient: "判定材料が少ない"
  }[lastScan.verdict] || "—";

  const reasonLabel = { price_anomaly: "価格が安すぎる疑い", seller_new: "新規アカウントの疑い" };
  const reasons = (lastScan.heuristics || []).map((h) => reasonLabel[h] || h);

  const m = lastScan.meta || {};
  el.innerHTML = `
    <div class="verdict ${lastScan.verdict}">${vlabel}</div>
    ${row("タイトル", escapeHtml(lastListing && lastListing.title ? lastListing.title : ""))}
    ${row("URL", escapeHtml(lastListing && lastListing.url ? lastListing.url : lastScan.listing_id))}
    ${row("価格 / 中央値", `${fmt(m.price)} / ${fmt(m.median != null ? Math.round(m.median) : NaN)}（n=${m.samples != null ? m.samples : 0}）`)}
    ${row("出品者の登録日数", m.seller_age_days != null ? m.seller_age_days + " 日" : "不明")}
    ${row("ひっかかった項目", reasons.length ? reasons.join(" / ") : "なし")}
    <h3>掲載画像</h3>
    <div class="imgs">${
      (lastListing && lastListing.images && lastListing.images.length
        ? lastListing.images.map((s) => `<img src="${escapeHtml(s)}">`).join("")
        : "（画像なし）")
    }</div>
    <div class="foot">ローカル生成：${new Date(lastScan.ts).toLocaleString()}　／　通信なし・参考情報</div>
  `;

  // 画像が読み込まれる猶予を少し置いてから印刷
  setTimeout(() => window.print(), 400);
})();
