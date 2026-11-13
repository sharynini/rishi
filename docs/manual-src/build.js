// 用法：node build.js '<toc json>' out.pdf
// 生成两份：封面（无页脚）+ 正文（第一页留空占位，让页码从 2 开始），再用 pypdf 合并
const { chromium } = require('playwright');
(async () => {
  const toc = JSON.parse(process.argv[2] || '{}');
  const out = process.argv[3] || 'out.pdf';
  const b = await chromium.launch();
  const p = await b.newPage();
  await p.goto('file://' + process.cwd() + '/manual.html');
  await p.evaluate(() => document.fonts.ready);
  await p.evaluate((toc) => { for (const [k, v] of Object.entries(toc)) { const el = document.querySelector(`[data-toc="${k}"]`); if (el) el.textContent = v; } }, toc);
  await p.pdf({ path: 'cover.pdf', format: 'A4', printBackground: true, preferCSSPageSize: true, pageRanges: '1' });
  await p.addStyleTag({ content: '.cover > * { visibility: hidden; } .cover { background: none; }' });
  await p.pdf({
    path: 'body.pdf', format: 'A4', printBackground: true, preferCSSPageSize: true,
    displayHeaderFooter: true, headerTemplate: '<div></div>',
    footerTemplate: `<div style="width:100%;margin:0 16mm;padding-top:2mm;border-top:1px dotted #e4d6c4;display:flex;justify-content:space-between;font:7pt 'Noto Sans CJK SC',sans-serif;color:#9a8b7e;-webkit-print-color-adjust:exact;"><span>日拾 · 使用手册 v0.9</span><span class="pageNumber"></span></div>`,
  });
  await b.close();
})();
