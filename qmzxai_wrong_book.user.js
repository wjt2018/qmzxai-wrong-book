// ==UserScript==
// @name         qmzxai 错题本（自动记录 + 一键导出）
// @namespace    https://qmzxai.com/
// @version      1.1.2
// @description  刷题时自动捕获答错的题目（题干/选项/我的答案/正确答案/解析），随时导出 Markdown 或 JSON。零额外请求，仅监听浏览器自己的流量。
// @match        http://www.qmzxai.com/*
// @match        https://www.qmzxai.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const STORE_KEY  = 'qmzx_wrong_v1';   // 错题本：questionCode -> 记录
  const QCACHE_KEY = 'qmzx_qcache_v1';  // 题目缓存：questionCode -> 题目全量（含 rightFlag）

  const load = (k) => { try { return JSON.parse(localStorage.getItem(k) || '{}'); } catch { return {}; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };

  let qcache = load(QCACHE_KEY);
  let wrong  = load(STORE_KEY);

  // ---------- 拦截 XHR（在 main.js 之前注册，所以挂得上）----------
  const OrigOpen = XMLHttpRequest.prototype.open;
  const OrigSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url) {
    this.__qmzx_url = url;
    return OrigOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function (body) {
    const url = this.__qmzx_url || '';
    // 站点用相对路径调接口（不带前导 /），所以匹配时不能加 /
    const isGetQ   = url.indexOf('backend/admin/getRandomQuestion') !== -1;
    const isSubmit = url.indexOf('backend/admin/submitResult')      !== -1;

    if (isSubmit && body) {
      try { this.__qmzx_submit = JSON.parse(body); } catch (e) {}
    }

    if (isGetQ || isSubmit) {
      console.log('[qmzx] 拦截到请求:', url);
      const xhr = this;
      xhr.addEventListener('load', function () {
        try {
          const data = JSON.parse(xhr.responseText);
          if (isGetQ) {
            console.log('[qmzx] 题目响应:', data);
            onQuestionResp(data);
          } else if (isSubmit) {
            console.log('[qmzx] 提交响应:', data, '题目:', xhr.__qmzx_submit);
            onSubmitResp(data, xhr.__qmzx_submit);
          }
        } catch (e) { console.warn('[qmzx] 解析响应失败:', e); }
      });
    }

    return OrigSend.apply(this, arguments);
  };

  function getChapterName() {
    // 优先取课程标题 H1，退化到文档标题
    const h1 = document.querySelector('.video-info-title h1, .video-info h1, h1');
    const txt = (h1 && h1.textContent || document.title || '').trim();
    return txt || '未分组';
  }

  function onQuestionResp(resp) {
    if (!resp || resp.success !== true) return;
    const map = (resp.data && resp.data.questionMap) || {};
    const chapterName = getChapterName();
    let touched = false;
    Object.values(map).forEach((q) => {
      if (!q || !q.code) return;
      qcache[q.code] = {
        questionCode: q.code,
        pointCode: q.knowledgePointCode,
        chapterName,
        type: q.type,
        title: q.title,
        analysis: q.analysis || null,
        options: (q.answerModelList || []).map((o) => ({
          code: o.code,
          name: o.name,
          right: o.rightFlag === 'TRUE',
        })),
      };
      touched = true;
    });
    if (touched) save(QCACHE_KEY, qcache);
  }

  function onSubmitResp(resp, submitInfo) {
    if (!resp || resp.success !== true) return;
    if (!submitInfo || !submitInfo.questionCode) return;
    const isWrong = Number(resp.data) === 0;
    if (!isWrong) return; // 答对：按需求不动错题本，保留之前的记录

    const q = qcache[submitInfo.questionCode];
    if (!q) return; // 极少：脚本刚装，题目没拉过就提交

    const chosenCodes = (submitInfo.answer || '').split(',').filter(Boolean);
    if (wrong[submitInfo.questionCode]) {
      const prev = wrong[submitInfo.questionCode];
      console.warn('[qmzx] ⚠️ 覆盖已有错题：',
        '\n  questionCode =', submitInfo.questionCode,
        '\n  旧题干 =', (prev.title || '').slice(0, 40),
        '\n  新题干 =', (q.title || '').slice(0, 40),
        '\n  旧类型 =', prev.type, ' 新类型 =', q.type);
    }
    wrong[submitInfo.questionCode] = {  // 同一道题反复错：覆盖，只留最后一次
      questionCode: q.questionCode,
      pointCode: q.pointCode,
      chapterName: q.chapterName || getChapterName(),
      type: q.type,
      title: q.title,
      options: q.options,
      correctCodes: q.options.filter(o => o.right).map(o => o.code),
      chosenCodes,
      analysis: q.analysis,
      pageUrl: location.href,
      lastWrongAt: new Date().toISOString(),
    };
    save(STORE_KEY, wrong);
    updateBadge();
  }

  // ---------- 浮动按钮 ----------
  function injectUI() {
    if (document.getElementById('qmzx-wrong-fab')) return;
    const box = document.createElement('div');
    box.id = 'qmzx-wrong-fab';
    box.innerHTML = `
      <style>
        #qmzx-wrong-fab{position:fixed;right:20px;bottom:20px;z-index:99999;font-family:-apple-system,Segoe UI,Roboto,sans-serif}
        #qmzx-wrong-fab .fab-btn{background:#d9534f;color:#fff;border-radius:24px;padding:10px 18px;
          box-shadow:0 4px 14px rgba(0,0,0,.28);cursor:pointer;font-size:14px;user-select:none;font-weight:600}
        #qmzx-wrong-fab .fab-menu{display:none;background:#fff;border:1px solid #e3e3e3;border-radius:10px;
          margin-bottom:10px;box-shadow:0 6px 20px rgba(0,0,0,.18);overflow:hidden;min-width:200px}
        #qmzx-wrong-fab .fab-menu a{display:block;padding:11px 16px;color:#333;text-decoration:none;
          font-size:13px;border-bottom:1px solid #eee;cursor:pointer}
        #qmzx-wrong-fab .fab-menu a:hover{background:#f6f6f6}
        #qmzx-wrong-fab .fab-menu a.danger{color:#d9534f}
        #qmzx-wrong-fab .fab-menu a:last-child{border-bottom:none}
      </style>
      <div class="fab-menu">
        <a data-act="md">⬇️ 下载 Markdown（按章节分组）</a>
        <a data-act="json">⬇️ 下载 JSON</a>
        <a data-act="anki">⬇️ 下载 Anki 卡片 (.txt)</a>
        <a data-act="info">ℹ️ 统计信息</a>
        <a data-act="clear" class="danger">🗑️ 清空错题本</a>
      </div>
      <div class="fab-btn">📝 错题本 (<span id="qmzx-cnt">0</span>)</div>
    `;
    document.body.appendChild(box);

    const menu = box.querySelector('.fab-menu');
    box.querySelector('.fab-btn').onclick = () => {
      menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
    };
    menu.addEventListener('click', (e) => {
      const a = e.target.closest('a'); if (!a) return;
      e.preventDefault();
      const act = a.dataset.act;
      if (act === 'md')   download('qmzxai_wrong.md',   toMarkdown(), 'text/markdown');
      if (act === 'json') download('qmzxai_wrong.json', JSON.stringify(wrong, null, 2), 'application/json');
      if (act === 'anki') download('qmzxai_wrong_anki.txt', toAnki(), 'text/tab-separated-values');
      if (act === 'info') {
        const byCh = groupByChapter(Object.values(wrong));
        const lines = Object.keys(byCh).sort().map(k => `  · ${k}：${byCh[k].length} 题`);
        alert(`错题数：${Object.keys(wrong).length}\n题目缓存：${Object.keys(qcache).length}\n\n按章节：\n${lines.join('\n') || '  （空）'}`);
      }
      if (act === 'clear') {
        if (confirm('确定清空错题本？此操作不可撤销（题目缓存不受影响）。')) {
          wrong = {}; save(STORE_KEY, wrong); updateBadge();
        }
      }
      menu.style.display = 'none';
    });
    updateBadge();
  }

  function updateBadge() {
    const el = document.getElementById('qmzx-cnt');
    if (el) el.textContent = Object.keys(wrong).length;
  }

  // ---------- 导出 ----------
  const TYPE_LABEL = { singleSelect: '单选', multiSelect: '多选', check: '判断' };

  function groupByChapter(items) {
    const g = {};
    items.forEach((q) => {
      const k = (q.chapterName || '未分组').trim();
      (g[k] = g[k] || []).push(q);
    });
    return g;
  }

  function toMarkdown() {
    const items = Object.values(wrong);
    if (!items.length) return '# qmzxai 错题本\n\n（暂无错题）\n';
    const groups = groupByChapter(items);
    const chapters = Object.keys(groups).sort();

    let md = `# qmzxai 错题本\n\n共 **${items.length}** 题，分布在 **${chapters.length}** 个章节　|　导出时间：${new Date().toLocaleString()}\n\n`;

    // 目录
    md += `## 目录\n\n`;
    chapters.forEach((ch, i) => {
      md += `${i + 1}. [${ch}](#${anchor(ch)}) — ${groups[ch].length} 题\n`;
    });
    md += `\n---\n\n`;

    // 正文：按章节分组
    chapters.forEach((ch) => {
      md += `## ${ch}\n\n`;
      const list = groups[ch].slice().sort((a, b) => (a.lastWrongAt || '').localeCompare(b.lastWrongAt || ''));
      list.forEach((q, i) => {
        md += `### ${i + 1}. \`[${TYPE_LABEL[q.type] || q.type}]\` ${q.title.trim()}\n\n`;
        q.options.forEach((o) => {
          const right  = o.right ? ' ✅' : '';
          const chosen = q.chosenCodes.includes(o.code) ? ' ❌(我选)' : '';
          md += `- ${o.name.trim()}${right}${chosen}\n`;
        });
        md += '\n';
        md += `- **我的答案**：${fmtAns(q.chosenCodes, q.options) || '(空)'}\n`;
        md += `- **正确答案**：${fmtAns(q.correctCodes, q.options) || '(无)'}\n`;
        if (q.analysis) md += `- **解析**：${q.analysis.trim()}\n`;
        md += `- *最后错误于 ${new Date(q.lastWrongAt).toLocaleString()}*\n\n`;
      });
      md += `---\n\n`;
    });
    return md;
  }

  function anchor(s) {
    // Markdown 锚点：去空格 & 特殊字符（GitHub 风格）
    return s.toLowerCase().replace(/[\s（）()\.,，。、:：]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  }

  function fmtAns(codes, options) {
    return codes
      .map((c) => (options.find((o) => o.code === c) || {}).name || '?')
      .map((s) => s.trim())
      .join('　/　');
  }

  // -------- Anki TSV 导出 --------
  // 格式：Front<TAB>Back<TAB>Tags  （字段内换行 → <br>，禁止 \t）
  function toAnki() {
    const items = Object.values(wrong);
    if (!items.length) return '';
    const safe = (s) => String(s || '').replace(/\t/g, ' ').replace(/\r?\n/g, '<br>').trim();
    const lines = [];
    // Anki 导入提示头（Anki 2.1.55+ 支持，老版本会忽略井号行）
    lines.push('#separator:tab');
    lines.push('#html:true');
    lines.push('#columns:Front\tBack\tTags');

    items.forEach((q) => {
      const typeLabel = TYPE_LABEL[q.type] || q.type;
      const optionsHtml = q.options.map(o => safe(o.name)).join('<br>');
      const front = `<b>[${typeLabel}]</b> ${safe(q.title)}<br><br>${optionsHtml}`;

      const correct = fmtAns(q.correctCodes, q.options);
      const chosen  = fmtAns(q.chosenCodes,  q.options);
      let back = `<b>正确答案：</b>${safe(correct)}<br><b>我曾选：</b>${safe(chosen) || '(空)'}`;
      if (q.analysis) back += `<br><br><b>解析：</b>${safe(q.analysis)}`;

      // 标签：章节名（空格→下划线，因为 Anki 用空格分标签）+ 题型
      const chTag = 'qmzxai::' + safe(q.chapterName || '未分组').replace(/<br>/g, ' ').replace(/\s+/g, '_');
      const typeTag = 'type::' + typeLabel;
      const tags = `${chTag} ${typeTag}`;

      lines.push(`${front}\t${back}\t${tags}`);
    });
    return lines.join('\n') + '\n';
  }

  function download(name, content, mime) {
    const blob = new Blob([content], { type: mime + ';charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
  }

  // ---------- 启动 ----------
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectUI);
  } else {
    injectUI();
  }
})();
