// =============================================================================
// ABA PERDAS POR EVENTO
// -----------------------------------------------------------------------------
// Mostra quanto se perde em cada EVENTO, quebrado por GRUPO > SUBGRUPO > CLASSE > ITEM,
// em uma árvore expansível ordenada do maior para o menor valor, com PDFs.
//
// Os dados vêm de statePerdas.rawProcessedData (módulo perdas.js): cada linha é
// produto x evento x operação, com perdaAtual, perdaAnterior, grupo, subgrupo, classe...
// Sinais: valor NEGATIVO = falta/perda, POSITIVO = sobra.
//
// A árvore é montada pelo CAMINHO completo (evento > grupo > subgrupo > classe), então
// subgrupos/classes com o mesmo nome em grupos diferentes não se misturam.
// =============================================================================
(function () {
    'use strict';

    const LEVELS = ['Evento', 'Grupo', 'Subgrupo', 'Classe', 'Item'];   // níveis 0..4
    const MODE_LABEL = {
        perdas: 'Somente perdas (faltas)',
        liquido: 'Líquido (perdas + sobras)',
        sobras: 'Somente sobras'
    };
    const SORT_LABEL = { atual: 'Perda Atual', anterior: 'Perda Anterior', variacao: 'Variação' };

    const peState = {
        mode: 'perdas',
        sortBy: 'atual',
        evento: '',
        comprador: '',
        search: '',
        depth: 3,            // "Detalhar até": 1 grupo, 2 subgrupo, 3 classe, 4 item
        top: 0,              // 0 = todos; N = só os N maiores por nível (+ "Demais")
        expanded: new Set(), // chaves (caminho) dos nós expandidos
        root: null,
        nodes: new Map()     // id -> nó (para o clique)
    };

    const $ = (id) => document.getElementById(id);

    // ------------------------------------------------------------------ utils
    function esc(v) {
        return String(v === null || v === undefined ? '' : v).replace(/[&<>"']/g, ch => (
            { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
        ));
    }

    function normTxt(v) {
        return String(v === null || v === undefined ? '' : v).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    }

    function fmtBRL(v, plus) {
        const n = Math.round((v || 0) * 100) / 100;
        const abs = Math.abs(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        if (n < 0) return `-R$ ${abs}`;
        return `${plus && n > 0 ? '+' : ''}R$ ${abs}`;
    }

    function fmtPct(p) {
        return p === null ? '-' : `${p.toFixed(1).replace('.', ',')}%`;
    }

    function valClass(v) {
        if (v < 0) return 'pe-neg';
        if (v > 0) return 'pe-pos';
        return '';
    }

    function pickMode(v) {
        v = v || 0;
        if (peState.mode === 'perdas') return v < 0 ? v : 0;
        if (peState.mode === 'sobras') return v > 0 ? v : 0;
        return v;
    }

    function eventoLabel(item) {
        const cod = String(item.evento === undefined || item.evento === null ? 'N/A' : item.evento);
        const desc = String(item.eventoDescricao || '').trim();
        if (cod === 'N/A' && !desc) return 'Sem evento';
        return desc ? `${cod} - ${desc}` : cod;
    }

    function getRawRows() {
        return (typeof statePerdas !== 'undefined' && Array.isArray(statePerdas.rawProcessedData)) ? statePerdas.rawProcessedData : [];
    }

    // ----------------------------------------------------------------- árvore
    function getFilteredRows() {
        const terms = normTxt(peState.search).split(/\s+/).filter(Boolean);
        return getRawRows().filter(item => {
            if (peState.evento && String(item.evento) !== peState.evento) return false;
            if (peState.comprador && item.comprador !== peState.comprador) return false;
            if (terms.length) {
                const hay = normTxt(`${item.descricao} ${item.codigoCompleto} ${eventoLabel(item)} ${item.grupo} ${item.subgrupo} ${item.classe}`);
                if (!terms.every(t => hay.includes(t))) return false;
            }
            return true;
        });
    }

    function buildTree() {
        let seq = 0;
        const newNode = (level, key, label, sub) => ({
            id: ++seq, level: level, key: key, label: label, sub: sub || '',
            atual: 0, anterior: 0, count: 0, kids: new Map(), sorted: null, isOthers: false
        });

        const root = newNode(-1, '', 'TOTAL', '');
        const nodes = new Map();
        nodes.set(root.id, root);

        getFilteredRows().forEach(item => {
            const a = pickMode(item.perdaAtual);
            const b = pickMode(item.perdaAnterior);
            if (a === 0 && b === 0) return;

            const segs = [
                { k: String(item.evento), label: eventoLabel(item), sub: '' },
                { k: item.grupo || 'N/A', label: item.grupo || 'N/A', sub: '' },
                { k: item.subgrupo || 'N/A', label: item.subgrupo || 'N/A', sub: '' },
                { k: item.classe || 'N/A', label: item.classe || 'N/A', sub: '' },
                { k: item.id, label: item.descricao || 'Produto Sem Descrição',
                  sub: `Cód ${item.codigoCompleto} · ${item.operacao || '-'} · ${item.embalagem || '-'}` }
            ];

            root.atual += a; root.anterior += b; root.count++;
            let node = root;
            segs.forEach((s, lvl) => {
                let child = node.kids.get(s.k);
                if (!child) {
                    child = newNode(lvl, node.key + '\u0001' + s.k, s.label, s.sub);
                    node.kids.set(s.k, child);
                    nodes.set(child.id, child);
                }
                child.atual += a; child.anterior += b; child.count++;
                node = child;
            });
        });

        peState.root = root;
        peState.nodes = nodes;
        return root;
    }

    function metricValue(n) {
        if (peState.sortBy === 'anterior') return n.anterior;
        if (peState.sortBy === 'variacao') return n.atual - n.anterior;
        return n.atual;
    }

    // Maiores perdas primeiro (mais negativo); em "somente sobras", maiores sobras primeiro
    function kidsOf(node) {
        if (!node.sorted) {
            const dir = peState.mode === 'sobras' ? -1 : 1;
            node.sorted = Array.from(node.kids.values()).sort((x, y) => (metricValue(x) - metricValue(y)) * dir);
        }
        return node.sorted;
    }

    // Filhos exibidos: respeita "Top N por nível" e junta o resto em "Demais (n)"
    let othersSeq = 0;
    function shownKids(node, topOverride) {
        const all = kidsOf(node);
        const top = topOverride === undefined ? peState.top : topOverride;
        if (!top || all.length <= top + 1) return all;
        const head = all.slice(0, top);
        const rest = all.slice(top);
        const others = {
            id: --othersSeq, level: node.level + 1, key: node.key + '\u0001__demais', label: `Demais (${rest.length})`, sub: '',
            atual: rest.reduce((s, n) => s + n.atual, 0),
            anterior: rest.reduce((s, n) => s + n.anterior, 0),
            count: rest.reduce((s, n) => s + n.count, 0),
            kids: new Map(), sorted: [], isOthers: true
        };
        return head.concat(others);
    }

    function flattenVisible(node, out) {
        shownKids(node).forEach(ch => {
            out.push({ node: ch, parent: node });
            if (!ch.isOthers && ch.level < 4 && peState.expanded.has(ch.key)) flattenVisible(ch, out);
        });
    }

    function expandAll() {
        peState.expanded.clear();
        const walk = (node) => {
            shownKids(node).forEach(ch => {
                if (ch.isOthers) return;
                if (ch.level < peState.depth) {
                    peState.expanded.add(ch.key);
                    walk(ch);
                }
            });
        };
        walk(peState.root);
    }

    // ------------------------------------------------------------------ render
    function pctOfParent(node, parent) {
        if (!parent || !parent.atual) return null;
        return (node.atual / parent.atual) * 100;
    }

    function renderKpis() {
        const root = peState.root;
        const set = (id, txt, cls) => {
            const el = $(id);
            if (!el) return;
            el.textContent = txt;
            if (cls !== undefined) el.style.color = cls;
        };
        const dif = root.atual - root.anterior;
        const colorOf = (v) => v < 0 ? '#ef4444' : (v > 0 ? '#22c55e' : '');
        set('peKpiAtual', fmtBRL(root.atual), colorOf(root.atual));
        set('peKpiAnterior', fmtBRL(root.anterior), colorOf(root.anterior));
        set('peKpiVariacao', fmtBRL(dif, true), colorOf(dif));
        set('peKpiEventos', root.kids.size.toLocaleString('pt-BR'));

        const first = kidsOf(root)[0];
        set('peKpiMaior', first ? first.label : '-');
        set('peKpiMaiorSub', first ? `${fmtBRL(first.atual)} (${fmtPct(pctOfParent(first, root))} do total)` : '');
    }

    function renderTable() {
        const tbody = $('peTableBody');
        if (!tbody) return;

        const raw = getRawRows();
        if (!raw.length) {
            tbody.innerHTML = '<tr><td colspan="7" class="empty-state">Carregue a pasta com os arquivos de perdas (PerdaAtual / PerdaAnterior) para ver a análise por evento.</td></tr>';
            $('peInfo').textContent = 'Sem dados de perdas';
            return;
        }

        const out = [];
        flattenVisible(peState.root, out);

        if (!out.length) {
            tbody.innerHTML = '<tr><td colspan="7" class="empty-state">Nenhum registro para os filtros selecionados.</td></tr>';
            $('peInfo').textContent = '0 linhas';
            return;
        }

        tbody.innerHTML = out.map(({ node, parent }) => {
            const expandable = !node.isOthers && node.level < 4 && node.kids.size > 0;
            const isOpen = expandable && peState.expanded.has(node.key);
            const caret = expandable ? (isOpen ? '▾' : '▸') : '';
            const pct = pctOfParent(node, parent);
            const barW = pct === null ? 0 : Math.max(0, Math.min(100, pct));
            const dif = node.atual - node.anterior;
            const cls = `pe-row pe-l${node.level}${expandable ? ' pe-click' : ''}${node.isOthers ? ' pe-others' : ''}`;

            return `<tr class="${cls}" data-id="${node.id}">
                <td class="pe-name" style="padding-left:${(0.4 + node.level * 1.2).toFixed(2)}rem">
                    <span class="pe-caret">${caret}</span><strong>${esc(node.label)}</strong>${node.sub ? `<span class="sub-text">${esc(node.sub)}</span>` : ''}
                </td>
                <td class="pe-num ${valClass(node.atual)}">${fmtBRL(node.atual)}</td>
                <td class="pe-num ${valClass(node.anterior)}">${fmtBRL(node.anterior)}</td>
                <td class="pe-num ${valClass(dif)}">${fmtBRL(dif, true)}</td>
                <td class="pe-num">${fmtPct(pct)}</td>
                <td class="pe-barcell"><div class="pe-bar"><span style="width:${barW.toFixed(1)}%"></span></div></td>
                <td class="pe-num">${node.level === 4 ? '-' : node.count.toLocaleString('pt-BR')}</td>
            </tr>`;
        }).join('');

        $('peInfo').textContent = `${out.length.toLocaleString('pt-BR')} linhas exibidas · ${peState.root.kids.size.toLocaleString('pt-BR')} eventos · ${MODE_LABEL[peState.mode]} · ordenado por ${SORT_LABEL[peState.sortBy]}`;
    }

    function refreshAll() {
        buildTree();
        renderKpis();
        renderTable();
    }

    function refreshSelectOptions() {
        const raw = getRawRows();

        // Eventos (maiores perdas primeiro, com o total líquido atual de cada um)
        const evMap = new Map();
        raw.forEach(it => {
            const k = String(it.evento);
            if (!evMap.has(k)) evMap.set(k, { label: eventoLabel(it), total: 0 });
            evMap.get(k).total += it.perdaAtual || 0;
        });
        const evs = Array.from(evMap.entries()).sort((a, b) => a[1].total - b[1].total);
        if (peState.evento && !evMap.has(peState.evento)) peState.evento = '';
        $('peEvento').innerHTML = '<option value="">Evento (Todos)</option>' +
            evs.map(([k, v]) => `<option value="${esc(k)}">${esc(v.label)} (${fmtBRL(v.total)})</option>`).join('');
        $('peEvento').value = peState.evento;

        // Compradores
        const comp = new Map();
        raw.forEach(it => {
            if (!it.comprador || it.comprador === 'N/A') return;
            comp.set(it.comprador, (comp.get(it.comprador) || 0) + (it.perdaAtual || 0));
        });
        const comps = Array.from(comp.entries()).sort((a, b) => a[1] - b[1]);
        if (peState.comprador && !comp.has(peState.comprador)) peState.comprador = '';
        $('peComprador').innerHTML = '<option value="">Comprador (Todos)</option>' +
            comps.map(([k, v]) => `<option value="${esc(k)}">${esc(k)} (${fmtBRL(v)})</option>`).join('');
        $('peComprador').value = peState.comprador;
    }

    function renderPerdasEventoTab(force) {
        if (!force && (typeof state === 'undefined' || state.activeTab !== 'tab-perdas-evento')) return;
        if (!$('peTableBody')) return;
        refreshSelectOptions();
        refreshAll();
    }
    window.renderPerdasEventoTab = renderPerdasEventoTab;

    // --------------------------------------------------------------------- PDF
    const PDF_LV = [
        { fill: [15, 23, 42], color: [255, 255, 255], bold: true, size: 7.5 },
        { fill: [226, 232, 240], color: [15, 23, 42], bold: true, size: 7 },
        { fill: [241, 245, 249], color: [30, 41, 59], bold: true, size: 6.8 },
        { fill: [255, 255, 255], color: [30, 41, 59], bold: false, size: 6.5 },
        { fill: [255, 255, 255], color: [100, 116, 139], bold: false, size: 6 }
    ];

    function flattenPdf(node, depth, top, out) {
        shownKids(node, top).forEach(ch => {
            out.push({ node: ch, parentAtual: node.atual });
            if (!ch.isOthers && ch.level < depth) flattenPdf(ch, depth, top, out);
        });
    }

    function filtrosTexto() {
        let t = `Valores: ${MODE_LABEL[peState.mode]}  |  Ordenação: ${SORT_LABEL[peState.sortBy]}`;
        if (peState.evento) {
            const opt = $('peEvento').selectedOptions && $('peEvento').selectedOptions[0];
            t += `  |  Evento: ${opt ? opt.textContent.replace(/\s\(-?R\$.*\)$/, '') : peState.evento}`;
        }
        if (peState.comprador) t += `  |  Comprador: ${peState.comprador}`;
        if (peState.search.trim()) t += `  |  Busca: ${peState.search.trim()}`;
        return t;
    }

    function exportPerdasEventoPDF(kind) {
        if (!window.jspdf) { alert('Biblioteca de PDF não carregada.'); return; }
        if (!getRawRows().length) { alert('Carregue os arquivos de perdas antes de gerar o PDF.'); return; }

        buildTree();
        const resumo = kind === 'resumo';
        const depth = resumo ? 1 : peState.depth;
        const top = resumo ? 5 : peState.top;
        const titulo = resumo ? 'PERDAS POR EVENTO - RESUMO' : 'PERDAS POR EVENTO - DETALHADO';

        const flat = [];
        flattenPdf(peState.root, depth, top, flat);
        if (!flat.length) { alert('Não há dados de perdas para os filtros selecionados.'); return; }
        if (flat.length > 2000 && !confirm(`O PDF terá ${flat.length.toLocaleString('pt-BR')} linhas. Continuar?`)) return;

        const bodyData = flat.map(({ node, parentAtual }) => {
            const pct = parentAtual ? (node.atual / parentAtual) * 100 : null;
            const nome = node.level === 4 && node.sub ? `${node.label}\n(${node.sub})` : node.label;
            return [nome, fmtBRL(node.atual), fmtBRL(node.anterior), fmtBRL(node.atual - node.anterior, true), fmtPct(pct)];
        });

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
        const now = new Date();
        const dateFormatted = now.toLocaleDateString('pt-BR');
        const stamp = `Gerado em: ${dateFormatted} às ${now.toLocaleTimeString('pt-BR')}`;
        const detalhe = resumo ? 'Eventos e os 5 maiores grupos de cada um'
            : `Detalhe até ${LEVELS[depth]}${top ? ` · Top ${top} por nível` : ''}`;
        const root = peState.root;
        const dif = root.atual - root.anterior;

        doc.autoTable({
            head: [['Evento ▸ Grupo ▸ Subgrupo ▸ Classe ▸ Item', 'Perda Atual', 'Perda Anterior', 'Variação', '% nível acima']],
            body: bodyData,
            startY: 24,
            margin: { top: 24, bottom: 14, left: 6, right: 6 },
            theme: 'grid',
            styles: { fontSize: 6.5, cellPadding: 0.9, valign: 'middle', overflow: 'linebreak', lineColor: [203, 213, 225], lineWidth: 0.12 },
            headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255], fontStyle: 'bold', halign: 'center', fontSize: 6.8 },
            columnStyles: {
                0: { cellWidth: 90 },
                1: { cellWidth: 28, halign: 'right' },
                2: { cellWidth: 28, halign: 'right' },
                3: { cellWidth: 28, halign: 'right' },
                4: { cellWidth: 24, halign: 'center' }
            },
            didParseCell: (data) => {
                if (data.section !== 'body') return;
                const meta = flat[data.row.index];
                if (!meta) return;
                const n = meta.node;
                const st = PDF_LV[Math.min(n.level, 4)];
                const dark = n.level === 0;
                data.cell.styles.fillColor = st.fill;
                data.cell.styles.fontSize = st.size;
                data.cell.styles.fontStyle = n.isOthers ? 'italic' : (st.bold ? 'bold' : 'normal');
                data.cell.styles.textColor = st.color;
                if (data.column.index === 0) {
                    data.cell.styles.cellPadding = { top: 0.9, bottom: 0.9, left: 1 + n.level * 3.5, right: 1 };
                } else if (data.column.index >= 1 && data.column.index <= 3) {
                    const v = data.column.index === 1 ? n.atual : (data.column.index === 2 ? n.anterior : n.atual - n.anterior);
                    if (v < 0) data.cell.styles.textColor = dark ? [252, 165, 165] : [185, 28, 28];
                    else if (v > 0) data.cell.styles.textColor = dark ? [134, 239, 172] : [21, 128, 61];
                }
            },
            didDrawPage: () => {
                const pageH = doc.internal.pageSize.height;
                const pageW = doc.internal.pageSize.width;
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(9);
                doc.setTextColor(11, 17, 32);
                doc.text(`StockAnalytics - ${titulo}`, 6, 9);
                doc.setFont('helvetica', 'normal');
                doc.setFontSize(6.3);
                doc.setTextColor(100, 116, 139);
                doc.text(filtrosTexto(), 6, 13);
                doc.text(`${detalhe}  |  Total atual: ${fmtBRL(root.atual)}  |  Anterior: ${fmtBRL(root.anterior)}  |  Variação: ${fmtBRL(dif, true)}`, 6, 16.5);
                doc.setLineWidth(0.2);
                doc.setDrawColor(203, 213, 225);
                doc.line(6, 19, pageW - 6, 19);
                doc.setFontSize(6);
                doc.setTextColor(71, 85, 105);
                doc.text(stamp, 6, pageH - 5);
            }
        });

        const total = doc.internal.getNumberOfPages();
        for (let i = 1; i <= total; i++) {
            doc.setPage(i);
            doc.setFontSize(6);
            doc.setTextColor(71, 85, 105);
            doc.text(`Página ${i} de ${total}`, doc.internal.pageSize.width - 25, doc.internal.pageSize.height - 5);
        }

        doc.save(`Perdas_${resumo ? 'Resumo' : 'Detalhado'}_por_Evento_${dateFormatted.replace(/\//g, '-')}.pdf`);
    }

    // ------------------------------------------------------------------ eventos
    function init() {
        if (!$('tab-perdas-evento')) return;

        $('peMode').addEventListener('change', (e) => { peState.mode = e.target.value; refreshAll(); });
        $('peSort').addEventListener('change', (e) => { peState.sortBy = e.target.value; refreshAll(); });
        $('peEvento').addEventListener('change', (e) => { peState.evento = e.target.value; refreshAll(); });
        $('peComprador').addEventListener('change', (e) => { peState.comprador = e.target.value; refreshAll(); });
        $('peDepth').addEventListener('change', (e) => { peState.depth = parseInt(e.target.value, 10); });
        $('peTop').addEventListener('change', (e) => { peState.top = parseInt(e.target.value, 10); refreshAll(); });

        let timer = null;
        $('peSearch').addEventListener('input', (e) => {
            peState.search = e.target.value;
            clearTimeout(timer);
            timer = setTimeout(refreshAll, 150);
        });

        $('btnPeExpand').addEventListener('click', () => { expandAll(); renderTable(); });
        $('btnPeCollapse').addEventListener('click', () => { peState.expanded.clear(); renderTable(); });
        $('btnPeClear').addEventListener('click', () => {
            peState.evento = ''; peState.comprador = ''; peState.search = '';
            $('peEvento').value = ''; $('peComprador').value = ''; $('peSearch').value = '';
            refreshAll();
        });

        $('peTableBody').addEventListener('click', (e) => {
            const tr = e.target.closest('tr[data-id]');
            if (!tr) return;
            const node = peState.nodes.get(parseInt(tr.getAttribute('data-id'), 10));
            if (!node || node.isOthers || node.level >= 4 || !node.kids.size) return;
            if (peState.expanded.has(node.key)) peState.expanded.delete(node.key);
            else peState.expanded.add(node.key);
            renderTable();
        });

        // Menu de PDF
        const dd = $('dropdownPePdf');
        $('btnPePdf').addEventListener('click', (e) => { e.stopPropagation(); dd.classList.toggle('hidden'); });
        document.addEventListener('click', (e) => {
            if (!dd.classList.contains('hidden') && !e.target.closest('#pePdfWrapper')) dd.classList.add('hidden');
        });
        $('btnPePdfResumo').addEventListener('click', () => { dd.classList.add('hidden'); exportPerdasEventoPDF('resumo'); });
        $('btnPePdfDetalhado').addEventListener('click', () => { dd.classList.add('hidden'); exportPerdasEventoPDF('detalhado'); });

        const tabBtn = document.querySelector('.tab-btn[data-tab="tab-perdas-evento"]');
        if (tabBtn) tabBtn.addEventListener('click', () => renderPerdasEventoTab(true));

        renderPerdasEventoTab(true);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
