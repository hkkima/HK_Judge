// 아주 가벼운 마크다운 → React 렌더러(의존성 없음).
//   문제 설명에 필요한 것만: 제목(#~###), 굵게(**), 인라인 코드(`), 코드블록(```),
//   순서/비순서 목록, 문단. XSS 방지를 위해 dangerouslySetInnerHTML 없이 엘리먼트로 렌더.

import { Fragment } from 'react';

// 인라인: **굵게** 와 `코드` 만 처리.
function renderInline(text, keyBase) {
  const nodes = [];
  // 백틱 코드가 우선. 토큰화.
  const parts = String(text).split(/(`[^`]+`)/g);
  parts.forEach((part, i) => {
    if (/^`[^`]+`$/.test(part)) {
      nodes.push(<code key={`${keyBase}-c${i}`} className="md-code">{part.slice(1, -1)}</code>);
    } else {
      // 굵게
      const bold = part.split(/(\*\*[^*]+\*\*)/g);
      bold.forEach((b, j) => {
        if (/^\*\*[^*]+\*\*$/.test(b)) {
          nodes.push(<strong key={`${keyBase}-b${i}-${j}`}>{b.slice(2, -2)}</strong>);
        } else if (b) {
          nodes.push(<Fragment key={`${keyBase}-t${i}-${j}`}>{b}</Fragment>);
        }
      });
    }
  });
  return nodes;
}

export function Markdown({ source }) {
  const src = String(source || '').replace(/\r\n/g, '\n');
  const lines = src.split('\n');
  const blocks = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 코드블록 ```
    if (/^```/.test(line.trim())) {
      const buf = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i].trim())) {
        buf.push(lines[i]);
        i += 1;
      }
      i += 1; // 닫는 ```
      blocks.push(<pre key={key++} className="md-pre"><code>{buf.join('\n')}</code></pre>);
      continue;
    }

    // 제목
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      const Tag = `h${level + 2}`; // h3~h5 (페이지 h1/h2 와 충돌 방지)
      blocks.push(<Tag key={key++} className="md-h">{renderInline(h[2], `h${key}`)}</Tag>);
      i += 1;
      continue;
    }

    // 목록 (- , * , 1.)
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line);
      const items = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
        const item = lines[i].replace(/^\s*([-*]|\d+\.)\s+/, '');
        items.push(<li key={items.length}>{renderInline(item, `li${key}-${items.length}`)}</li>);
        i += 1;
      }
      blocks.push(ordered
        ? <ol key={key++} className="md-list">{items}</ol>
        : <ul key={key++} className="md-list">{items}</ul>);
      continue;
    }

    // 표: | ... | 다음 줄이 |---|---| 구분선
    if (/^\s*\|/.test(line) && i + 1 < lines.length
      && /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(lines[i + 1])) {
      const parseRow = (ln) => ln.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
      const header = parseRow(line);
      i += 2; // 헤더 + 구분선 건너뜀
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) { rows.push(parseRow(lines[i])); i += 1; }
      blocks.push(
        <table key={key++} className="md-table">
          <thead><tr>{header.map((c, ci) => <th key={ci}>{renderInline(c, `th${key}-${ci}`)}</th>)}</tr></thead>
          <tbody>{rows.map((r, ri) => (
            <tr key={ri}>{r.map((c, ci) => <td key={ci}>{renderInline(c, `td${key}-${ri}-${ci}`)}</td>)}</tr>
          ))}</tbody>
        </table>,
      );
      continue;
    }

    // 빈 줄
    if (line.trim() === '') { i += 1; continue; }

    // 문단(연속된 비어있지 않은 줄)
    const para = [];
    while (i < lines.length && lines[i].trim() !== '' && !/^```/.test(lines[i].trim())
      && !/^(#{1,3})\s+/.test(lines[i]) && !/^\s*([-*]|\d+\.)\s+/.test(lines[i])
      && !/^\s*\|/.test(lines[i])) {
      para.push(lines[i]);
      i += 1;
    }
    blocks.push(<p key={key++} className="md-p">{renderInline(para.join(' '), `p${key}`)}</p>);
  }

  return <div className="md">{blocks}</div>;
}
