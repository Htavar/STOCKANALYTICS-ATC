/**
 * MÓDULO DE GRÁFICOS ANALÍTICOS DE PERDAS (DASHBOARD)
 */

let chartPerdaEventosInst = null;
let chartPerdaOperacoesInst = null;
let chartPerdaCompradoresInst = null;
let chartPerdaSetoresInst = null;
let chartPerdaParetoInst = null;
let chartPerdaGruposInst = null;
let chartPerdaSubgruposInst = null;
let chartPerdaClassesInst = null;
let chartPerdaMaioresAumentosInst = null;

const stateGraficoPerdas = {
    metric: 'perdaAtual',
    sortOrder: 'desc',
    limit: 10,
    gridCols: '3',
    rankingSorts: {
        eventos: { key: 'diferencaPerdas', order: 'asc' },
        compradores: { key: 'diferencaPerdas', order: 'asc' },
        grupos: { key: 'diferencaPerdas', order: 'asc' }
    }
};

document.addEventListener('DOMContentLoaded', () => {
    initGraficoPerdasModule();
});

function initGraficoPerdasModule() {
    const selMetric = document.getElementById('chartPerdaMetric');
    const selOrder = document.getElementById('chartPerdaSortOrder');
    const selGrid = document.getElementById('chartPerdaGridCols');
    const selLimit = document.getElementById('chartPerdaLimit');
    const btnPdf = document.getElementById('btnExportPerdasExecutivePdf');
    const btnToggleCharts = document.getElementById('btnTogglePerdasCharts');
    const dropdownCharts = document.getElementById('dropdownPerdasCharts');

    if (selMetric) selMetric.addEventListener('change', (e) => { stateGraficoPerdas.metric = e.target.value; renderGraficoPerdasTab(); });
    if (selOrder) selOrder.addEventListener('change', (e) => { stateGraficoPerdas.sortOrder = e.target.value; renderGraficoPerdasTab(); });
    if (selLimit) selLimit.addEventListener('change', (e) => { stateGraficoPerdas.limit = Number(e.target.value); renderGraficoPerdasTab(); });

    if (selGrid) {
        selGrid.addEventListener('change', (e) => {
            stateGraficoPerdas.gridCols = e.target.value;
            const grid = document.getElementById('chartsPerdasGrid');
            if (grid) {
                grid.className = `charts-dashboard-grid grid-cols-${e.target.value}`;
                setTimeout(() => resizeAllPerdasCharts(), 50);
            }
        });
    }

    if (btnToggleCharts && dropdownCharts) {
        btnToggleCharts.addEventListener('click', (e) => {
            e.stopPropagation();
            dropdownCharts.classList.toggle('hidden');
        });

        document.addEventListener('click', (e) => {
            if (!dropdownCharts.contains(e.target) && e.target !== btnToggleCharts) {
                dropdownCharts.classList.add('hidden');
            }
        });

        dropdownCharts.querySelectorAll('input[type="checkbox"]').forEach(chk => {
            chk.addEventListener('change', (e) => {
                const targetId = e.target.getAttribute('data-target-chart');
                const card = document.getElementById(targetId);
                if (card) card.classList.toggle('hidden', !e.target.checked);
            });
        });
    }

    if (btnPdf) btnPdf.addEventListener('click', exportPerdasExecutivePdf);

    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const tabId = e.target.getAttribute('data-tab');
            if (tabId === 'tab-grafico-perdas') {
                renderGraficoPerdasTab();
            }
        });
    });

    bindRankingTableHeaders();
    initPerdasDragAndDrop();
}

function resizeAllPerdasCharts() {
    [chartPerdaEventosInst, chartPerdaOperacoesInst, chartPerdaCompradoresInst, chartPerdaSetoresInst, chartPerdaParetoInst, chartPerdaGruposInst, chartPerdaSubgruposInst, chartPerdaClassesInst, chartPerdaMaioresAumentosInst].forEach(c => c && c.resize());
}

function initPerdasDragAndDrop() {
    const grid = document.getElementById('chartsPerdasGrid');
    if (!grid) return;

    let draggedCard = null;

    grid.querySelectorAll('.chart-card, .ranking-card').forEach(card => {
        card.setAttribute('draggable', 'true');

        card.addEventListener('dragstart', (e) => {
            draggedCard = card;
            card.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
        });

        card.addEventListener('dragend', () => {
            card.classList.remove('dragging');
            draggedCard = null;
            grid.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
        });

        card.addEventListener('dragover', (e) => {
            e.preventDefault();
            if (card !== draggedCard) card.classList.add('drag-over');
        });

        card.addEventListener('dragleave', () => card.classList.remove('drag-over'));

        card.addEventListener('drop', (e) => {
            e.preventDefault();
            card.classList.remove('drag-over');
            if (draggedCard && card !== draggedCard) {
                const siblings = Array.from(grid.children);
                const draggedIdx = siblings.indexOf(draggedCard);
                const targetIdx = siblings.indexOf(card);
                if (draggedIdx < targetIdx) card.after(draggedCard);
                else card.before(draggedCard);
            }
        });
    });
}

// DRILL-DOWN: Clica na vela/fatia -> Reseta os filtros anteriores e filtra o novo item na aba Perdas
function drillDownToPerdasTable(fieldKey, value) {
    const btnTabPerdas = document.querySelector('.tab-btn[data-tab="tab-perdas"]');
    if (btnTabPerdas) btnTabPerdas.click();

    if (typeof statePerdas !== 'undefined' && typeof elementsPerdas !== 'undefined') {
        
        // 1. LIMPA TODOS OS FILTROS ANTERIORES DA TABELA DE PERDAS
        if (typeof clearPerdasFilters === 'function') {
            clearPerdasFilters();
        } else {
            if (elementsPerdas.searchProdCod) elementsPerdas.searchProdCod.value = '';
            if (elementsPerdas.searchEmb) elementsPerdas.searchEmb.value = '';
            if (elementsPerdas.filterEvento) elementsPerdas.filterEvento.value = '';
            if (elementsPerdas.filterOperacao) elementsPerdas.filterOperacao.value = '';
            if (elementsPerdas.filterGrupo) elementsPerdas.filterGrupo.value = '';
            if (elementsPerdas.filterSubgrupo) elementsPerdas.filterSubgrupo.value = '';
            if (elementsPerdas.filterClasse) elementsPerdas.filterClasse.value = '';
            if (elementsPerdas.filterComprador) elementsPerdas.filterComprador.value = '';
            if (elementsPerdas.filterSetorBalanco) elementsPerdas.filterSetorBalanco.value = '';
        }

        // 2. APLICA EXCLUSIVAMENTE O FILTRO DO ITEM CLICADO
        if (fieldKey === 'evento' && elementsPerdas.filterEvento) elementsPerdas.filterEvento.value = value;
        else if (fieldKey === 'operacao' && elementsPerdas.filterOperacao) elementsPerdas.filterOperacao.value = value;
        else if (fieldKey === 'comprador' && elementsPerdas.filterComprador) elementsPerdas.filterComprador.value = value;
        else if (fieldKey === 'setorBalanco' && elementsPerdas.filterSetorBalanco) elementsPerdas.filterSetorBalanco.value = value;
        else if (fieldKey === 'grupo' && elementsPerdas.filterGrupo) elementsPerdas.filterGrupo.value = value;
        else if (fieldKey === 'subgrupo' && elementsPerdas.filterSubgrupo) elementsPerdas.filterSubgrupo.value = value;
        else if (fieldKey === 'classe' && elementsPerdas.filterClasse) elementsPerdas.filterClasse.value = value;
        else if (fieldKey === 'produto' && elementsPerdas.searchProdCod) elementsPerdas.searchProdCod.value = value;

        // 3. RESETA A PAGINAÇÃO E RE-APLICA OS FILTROS NA TABELA
        if (typeof statePerdas !== 'undefined') statePerdas.currentPage = 1;
        if (typeof applyPerdasFilters === 'function') applyPerdasFilters();
    }
}

function aggregatePerdasData(keyField) {
    if (typeof statePerdas === 'undefined' || !Array.isArray(statePerdas.rawProcessedData)) return [];

    const map = new Map();
    statePerdas.rawProcessedData.forEach(item => {
        let key = item[keyField] || 'N/A';
        if (key === 'N/A' || key.trim() === '') return;

        if (!map.has(key)) {
            map.set(key, { name: key, perdaAnterior: 0, perdaAtual: 0, diferencaPerdas: 0 });
        }

        const entry = map.get(key);
        entry.perdaAnterior += item.perdaAnterior || 0;
        entry.perdaAtual += item.perdaAtual || 0;
        entry.diferencaPerdas += item.diferencaPerdas || 0;
    });

    return Array.from(map.values()).map(e => {
        let pct = 0;
        if (Math.abs(e.perdaAnterior) > 0) pct = (e.diferencaPerdas / Math.abs(e.perdaAnterior)) * 100;
        else if (Math.abs(e.perdaAtual) > 0) pct = e.perdaAtual < 0 ? -100 : 100;

        return { ...e, pctEvolucaoPerdas: pct };
    });
}

function sortAndLimitPerdas(data) {
    const metric = stateGraficoPerdas.metric;
    const isDesc = stateGraficoPerdas.sortOrder === 'desc';
    const mult = isDesc ? 1 : -1;

    const sorted = [...data].sort((a, b) => {
        let valA = a[metric] ?? 0;
        let valB = b[metric] ?? 0;
        return (valA - valB) * mult;
    });

    return stateGraficoPerdas.limit > 0 ? sorted.slice(0, stateGraficoPerdas.limit) : sorted;
}

function formatCurrencyPerdas(val) {
    if (val === 0) return 'R$ 0,00';
    const sign = val < 0 ? '-' : '+';
    const formatted = Math.abs(val).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `${sign}R$ ${formatted}`;
}

function formatPctPerdas(val) {
    if (val === 0) return '0,0%';
    const sign = val < 0 ? '-' : '+';
    return `${sign}${Math.abs(val).toFixed(1)}%`;
}

function renderGraficoPerdasTab() {
    if (typeof statePerdas === 'undefined' || !statePerdas.rawProcessedData) return;

    const rawData = statePerdas.rawProcessedData;
    const totAnt = rawData.reduce((sum, i) => sum + i.perdaAnterior, 0);
    const totAtu = rawData.reduce((sum, i) => sum + i.perdaAtual, 0);
    const totDif = totAtu - totAnt;
    let totPct = Math.abs(totAnt) > 0 ? (totDif / Math.abs(totAnt)) * 100 : (Math.abs(totAtu) > 0 ? -100 : 0);

    let totalVendaAtual = 0;
    if (typeof window.state !== 'undefined' && Array.isArray(window.state.rawProcessedData)) {
        totalVendaAtual = window.state.rawProcessedData.reduce((s, i) => s + (i.vendaAtual || 0), 0);
    } else if (typeof state !== 'undefined' && Array.isArray(state.rawProcessedData)) {
        totalVendaAtual = state.rawProcessedData.reduce((s, i) => s + (i.vendaAtual || 0), 0);
    }
    const pctPerdaVenda = totalVendaAtual > 0 ? (Math.abs(totAtu) / totalVendaAtual) * 100 : 0;

    if (document.getElementById('kpiChartsPerdaAnterior')) document.getElementById('kpiChartsPerdaAnterior').textContent = formatCurrencyPerdas(totAnt);
    if (document.getElementById('kpiChartsPerdaAtual')) document.getElementById('kpiChartsPerdaAtual').textContent = formatCurrencyPerdas(totAtu);
    
    if (document.getElementById('kpiChartsDiferencaPerdas')) {
        const el = document.getElementById('kpiChartsDiferencaPerdas');
        el.textContent = formatCurrencyPerdas(totDif);
        el.style.color = totDif < 0 ? '#ef4444' : '#22c55e';
    }
    if (document.getElementById('kpiChartsPctEvolucaoPerdas')) {
        const el = document.getElementById('kpiChartsPctEvolucaoPerdas');
        el.textContent = formatPctPerdas(totPct);
        el.style.color = totPct < 0 ? '#ef4444' : '#22c55e';
    }
    if (document.getElementById('kpiChartsPctPerdaSobreVenda')) {
        document.getElementById('kpiChartsPctPerdaSobreVenda').textContent = `${pctPerdaVenda.toFixed(2)}%`;
    }

    renderChartEventos();
    renderChartOperacoes();
    renderChartCompradores();
    renderChartSetores();
    renderChartAvariasAjustes();
    renderChartGrupos();
    renderChartSubgrupos();
    renderChartClasses();
    renderChartMaioresAumentos();

    renderRankingPerdas('rankingPerdasEventosBody', aggregatePerdasData('evento'), 'eventos', 'evento');
    renderRankingPerdas('rankingPerdasCompradoresBody', aggregatePerdasData('comprador'), 'compradores', 'comprador');
    renderRankingPerdas('rankingPerdasGruposBody', aggregatePerdasData('grupo'), 'grupos', 'grupo');
}

// BIND AUTOMÁTICO DE CLIQUE NOS CABEÇALHOS DAS TABELAS INFERIORES
function bindRankingTableHeaders() {
    const colKeys = ['name', 'perdaAnterior', 'perdaAtual', 'diferencaPerdas', 'pctEvolucaoPerdas'];
    
    const tables = [
        { id: 'rankingPerdasEventosBody', tableKey: 'eventos' },
        { id: 'rankingPerdasCompradoresBody', tableKey: 'compradores' },
        { id: 'rankingPerdasGruposBody', tableKey: 'grupos' }
    ];

    tables.forEach(t => {
        const tbody = document.getElementById(t.id);
        if (!tbody) return;
        const table = tbody.closest('table');
        if (!table) return;

        const ths = table.querySelectorAll('thead th');
        ths.forEach((th, idx) => {
            if (idx < colKeys.length) {
                th.style.cursor = 'pointer';
                th.title = 'Clique para ordenar';
                th.onclick = () => sortRankingPerdasTable(t.tableKey, colKeys[idx]);
            }
        });
    });
}

// ORDENAÇÃO DINÂMICA DAS TABELAS DE RANKING
function sortRankingPerdasTable(tableKey, columnKey) {
    const current = stateGraficoPerdas.rankingSorts[tableKey];
    if (current.key === columnKey) {
        current.order = current.order === 'asc' ? 'desc' : 'asc';
    } else {
        current.key = columnKey;
        current.order = 'asc';
    }

    ['name', 'perdaAnterior', 'perdaAtual', 'diferencaPerdas', 'pctEvolucaoPerdas'].forEach(col => {
        const iconEl = document.getElementById(`sortIcon_${tableKey}_${col}`);
        if (iconEl) {
            if (col === columnKey) iconEl.textContent = current.order === 'asc' ? '▲' : '▼';
            else iconEl.textContent = '⇕';
        }
    });

    const fieldMap = { eventos: 'evento', compradores: 'comprador', grupos: 'grupo' };
    const tbodyIdMap = { eventos: 'rankingPerdasEventosBody', compradores: 'rankingPerdasCompradoresBody', grupos: 'rankingPerdasGruposBody' };
    
    renderRankingPerdas(tbodyIdMap[tableKey], aggregatePerdasData(fieldMap[tableKey]), tableKey, fieldMap[tableKey]);
}
window.sortRankingPerdasTable = sortRankingPerdasTable;

function renderRankingPerdas(containerId, data, tableKey, fieldKey) {
    const el = document.getElementById(containerId);
    if (!el) return;

    const sortConfig = stateGraficoPerdas.rankingSorts[tableKey];
    const mult = sortConfig.order === 'asc' ? 1 : -1;

    const sorted = [...data].sort((a, b) => {
        let valA = a[sortConfig.key];
        let valB = b[sortConfig.key];

        if (typeof valA === 'string') {
            return valA.localeCompare(valB) * mult;
        }
        return (valA - valB) * mult;
    });

    if (!sorted.length) { el.innerHTML = `<tr><td colspan="6" class="empty-state">Sem dados.</td></tr>`; return; }

    el.innerHTML = sorted.map(item => {
        const isFalta = item.diferencaPerdas < 0;
        const colorStyle = isFalta ? 'color: #ef4444; font-weight:700;' : 'color: #22c55e; font-weight:700;';
        const nameEscaped = item.name.replace(/'/g, "\\'");

        return `
        <tr>
            <td title="${item.name}"><strong>${item.name}</strong></td>
            <td>${formatCurrencyPerdas(item.perdaAnterior)}</td>
            <td><strong>${formatCurrencyPerdas(item.perdaAtual)}</strong></td>
            <td style="${colorStyle}">${formatCurrencyPerdas(item.diferencaPerdas)}</td>
            <td style="${colorStyle}">${formatPctPerdas(item.pctEvolucaoPerdas)}</td>
            <td>
                <button class="btn-action-filter" onclick="drillDownToPerdasTable('${fieldKey}', '${nameEscaped}')" title="Filtrar na aba Perdas">🔍</button>
            </td>
        </tr>`;
    }).join('');
}

// 1. EVENTOS
function renderChartEventos() {
    const ctx = document.getElementById('chartPerdaEventos');
    if (!ctx) return;
    if (chartPerdaEventosInst) chartPerdaEventosInst.destroy();

    const data = sortAndLimitPerdas(aggregatePerdasData('evento'));
    chartPerdaEventosInst = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: data.map(i => i.name),
            datasets: [
                { label: 'Perda Ant.', data: data.map(i => i.perdaAnterior), backgroundColor: '#f97316', borderRadius: 3 },
                { label: 'Perda Atu.', data: data.map(i => i.perdaAtual), backgroundColor: '#ef4444', borderRadius: 3 }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            onClick: (e, active) => { if (active.length) drillDownToPerdasTable('evento', data[active[0].index].name); },
            plugins: { legend: { labels: { color: '#f8fafc', font: { size: 9 } } } },
            scales: { x: { ticks: { color: '#94a3b8', font: { size: 8 } } }, y: { ticks: { color: '#f8fafc', font: { size: 8 } } } }
        }
    });
}

// 2. OPERAÇÕES
function renderChartOperacoes() {
    const ctx = document.getElementById('chartPerdaOperacoes');
    if (!ctx) return;
    if (chartPerdaOperacoesInst) chartPerdaOperacoesInst.destroy();

    const data = sortAndLimitPerdas(aggregatePerdasData('operacao'));
    chartPerdaOperacoesInst = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: data.map(i => i.name),
            datasets: [{ label: 'Perda Atual (R$)', data: data.map(i => i.perdaAtual), backgroundColor: '#e11d48', borderRadius: 3 }]
        },
        options: {
            indexAxis: 'y', responsive: true, maintainAspectRatio: false,
            onClick: (e, active) => { if (active.length) drillDownToPerdasTable('operacao', data[active[0].index].name); },
            plugins: { legend: { labels: { color: '#f8fafc', font: { size: 9 } } } },
            scales: { x: { ticks: { color: '#94a3b8', font: { size: 8 } } }, y: { ticks: { color: '#f8fafc', font: { size: 8 } } } }
        }
    });
}

// 3. COMPRADORES
function renderChartCompradores() {
    const ctx = document.getElementById('chartPerdaCompradores');
    if (!ctx) return;
    if (chartPerdaCompradoresInst) chartPerdaCompradoresInst.destroy();

    const data = sortAndLimitPerdas(aggregatePerdasData('comprador'));
    chartPerdaCompradoresInst = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: data.map(i => i.name),
            datasets: [
                { label: 'Perda Ant.', data: data.map(i => i.perdaAnterior), backgroundColor: '#38bdf8', borderRadius: 3 },
                { label: 'Perda Atu.', data: data.map(i => i.perdaAtual), backgroundColor: '#ef4444', borderRadius: 3 }
            ]
        },
        options: {
            indexAxis: 'y', responsive: true, maintainAspectRatio: false,
            onClick: (e, active) => { if (active.length) drillDownToPerdasTable('comprador', data[active[0].index].name); },
            plugins: { legend: { labels: { color: '#f8fafc', font: { size: 9 } } } },
            scales: { x: { ticks: { color: '#94a3b8', font: { size: 8 } } }, y: { ticks: { color: '#f8fafc', font: { size: 8 } } } }
        }
    });
}

// 4. SETORES BALANÇO
function renderChartSetores() {
    const ctx = document.getElementById('chartPerdaSetores');
    if (!ctx) return;
    if (chartPerdaSetoresInst) chartPerdaSetoresInst.destroy();

    const data = sortAndLimitPerdas(aggregatePerdasData('setorBalanco'));
    chartPerdaSetoresInst = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: data.map(i => i.name),
            datasets: [{ label: 'Perda Atual (R$)', data: data.map(i => i.perdaAtual), backgroundColor: '#8b5cf6', borderRadius: 3 }]
        },
        options: {
            indexAxis: 'y', responsive: true, maintainAspectRatio: false,
            onClick: (e, active) => { if (active.length) drillDownToPerdasTable('setorBalanco', data[active[0].index].name); },
            plugins: { legend: { labels: { color: '#f8fafc', font: { size: 9 } } } },
            scales: { x: { ticks: { color: '#94a3b8', font: { size: 8 } } }, y: { ticks: { color: '#f8fafc', font: { size: 8 } } } }
        }
    });
}

// 5. AVARIAS (EVENTO 1500) VS AJUSTES (OUTROS EVENTOS) - SOMA ALGÉBRICA CORRETA
function renderChartAvariasAjustes() {
    const ctx = document.getElementById('chartPerdaPareto');
    if (!ctx) return;
    if (chartPerdaParetoInst) chartPerdaParetoInst.destroy();

    const raw = typeof statePerdas !== 'undefined' ? statePerdas.rawProcessedData : [];
    let sumAvarias = 0;
    let sumAjustes = 0;

    raw.forEach(i => {
        const ev = String(i.evento || '').trim();
        const val = i.perdaAtual || 0;
        if (ev === '1500' || ev.includes('1500')) {
            sumAvarias += val;
        } else {
            sumAjustes += val;
        }
    });

    const absAvarias = Math.abs(sumAvarias);
    const absAjustes = Math.abs(sumAjustes);
    const totalAbs = absAvarias + absAjustes;

    const pctAvarias = totalAbs > 0 ? ((absAvarias / totalAbs) * 100).toFixed(1) : '0.0';
    const pctAjustes = totalAbs > 0 ? ((absAjustes / totalAbs) * 100).toFixed(1) : '0.0';

    chartPerdaParetoInst = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: [`Avarias Ev.1500 (${pctAvarias}%)`, `Ajustes Outros (${pctAjustes}%)`],
            datasets: [{
                data: [absAvarias, absAjustes],
                backgroundColor: ['#ef4444', '#38bdf8'],
                borderColor: '#1e293b',
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            onClick: (e, active) => {
                if (active.length > 0) {
                    const idx = active[0].index;
                    if (idx === 0) drillDownToPerdasTable('evento', '1500');
                }
            },
            plugins: {
                legend: { position: 'bottom', labels: { color: '#f8fafc', font: { size: 10 } } },
                tooltip: {
                    callbacks: {
                        label: (c) => {
                            const val = c.dataset.data[c.dataIndex];
                            const realVal = c.dataIndex === 0 ? sumAvarias : sumAjustes;
                            const pct = totalAbs > 0 ? ((val / totalAbs) * 100).toFixed(1) : '0.0';
                            return ` ${c.label.split(' (')[0]}: ${formatCurrencyPerdas(realVal)} (${pct}%)`;
                        }
                    }
                }
            }
        }
    });
}

// 6. GRUPOS
function renderChartGrupos() {
    const ctx = document.getElementById('chartPerdaGrupos');
    if (!ctx) return;
    if (chartPerdaGruposInst) chartPerdaGruposInst.destroy();

    const data = sortAndLimitPerdas(aggregatePerdasData('grupo'));
    chartPerdaGruposInst = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: data.map(i => i.name),
            datasets: [
                { label: 'Perda Ant.', data: data.map(i => i.perdaAnterior), backgroundColor: '#f97316', borderRadius: 3 },
                { label: 'Perda Atu.', data: data.map(i => i.perdaAtual), backgroundColor: '#ef4444', borderRadius: 3 }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            onClick: (e, active) => { if (active.length) drillDownToPerdasTable('grupo', data[active[0].index].name); },
            plugins: { legend: { labels: { color: '#f8fafc', font: { size: 9 } } } },
            scales: { x: { ticks: { color: '#f8fafc', font: { size: 8 }, maxRotation: 45 }, grid: { color: '#26334d' } }, y: { ticks: { color: '#94a3b8', font: { size: 8 } } } }
        }
    });
}

// 7. SUBGRUPOS
function renderChartSubgrupos() {
    const ctx = document.getElementById('chartPerdaSubgrupos');
    if (!ctx) return;
    if (chartPerdaSubgruposInst) chartPerdaSubgruposInst.destroy();

    const data = sortAndLimitPerdas(aggregatePerdasData('subgrupo'));
    chartPerdaSubgruposInst = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: data.map(i => i.name),
            datasets: [
                { label: 'Perda Ant.', data: data.map(i => i.perdaAnterior), backgroundColor: '#f97316', borderRadius: 3 },
                { label: 'Perda Atu.', data: data.map(i => i.perdaAtual), backgroundColor: '#ef4444', borderRadius: 3 }
            ]
        },
        options: {
            indexAxis: 'y', responsive: true, maintainAspectRatio: false,
            onClick: (e, active) => { if (active.length) drillDownToPerdasTable('subgrupo', data[active[0].index].name); },
            plugins: { legend: { labels: { color: '#f8fafc', font: { size: 9 } } } },
            scales: { x: { ticks: { color: '#94a3b8', font: { size: 8 } } }, y: { ticks: { color: '#f8fafc', font: { size: 8 } } } }
        }
    });
}

// 8. CLASSES
function renderChartClasses() {
    const ctx = document.getElementById('chartPerdaClasses');
    if (!ctx) return;
    if (chartPerdaClassesInst) chartPerdaClassesInst.destroy();

    const data = sortAndLimitPerdas(aggregatePerdasData('classe'));
    chartPerdaClassesInst = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: data.map(i => i.name),
            datasets: [{ label: 'Perda Atual (R$)', data: data.map(i => i.perdaAtual), backgroundColor: '#0284c7', borderRadius: 3 }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            onClick: (e, active) => { if (active.length) drillDownToPerdasTable('classe', data[active[0].index].name); },
            plugins: { legend: { labels: { color: '#f8fafc', font: { size: 9 } } } },
            scales: { x: { ticks: { color: '#f8fafc', font: { size: 8 } } }, y: { ticks: { color: '#94a3b8', font: { size: 8 } } } }
        }
    });
}

// 9. MAIORES AUMENTOS DE PERDA (R$)
function renderChartMaioresAumentos() {
    const ctx = document.getElementById('chartPerdaMaioresAumentos');
    if (!ctx) return;
    if (chartPerdaMaioresAumentosInst) chartPerdaMaioresAumentosInst.destroy();

    const raw = typeof statePerdas !== 'undefined' ? statePerdas.rawProcessedData : [];
    const sorted = [...raw].sort((a, b) => a.diferencaPerdas - b.diferencaPerdas).slice(0, stateGraficoPerdas.limit || 10);

    chartPerdaMaioresAumentosInst = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: sorted.map(i => i.descricao.length > 20 ? i.descricao.slice(0,20)+'...' : i.descricao),
            datasets: [{ label: 'Maior Aumento de Perda (R$)', data: sorted.map(i => i.diferencaPerdas), backgroundColor: '#dc2626', borderRadius: 3 }]
        },
        options: {
            indexAxis: 'y', responsive: true, maintainAspectRatio: false,
            onClick: (e, active) => { if (active.length) drillDownToPerdasTable('produto', sorted[active[0].index].codigoCompleto); },
            plugins: { legend: { labels: { color: '#f8fafc', font: { size: 9 } } } },
            scales: { x: { ticks: { color: '#94a3b8', font: { size: 8 } } }, y: { ticks: { color: '#f8fafc', font: { size: 8 } } } }
        }
    });
}

// RELATÓRIO PDF EXECUTIVO DE PERDAS
function exportPerdasExecutivePdf() {
    if (typeof statePerdas === 'undefined' || !statePerdas.rawProcessedData.length) {
        alert("Não há dados de perdas carregados para gerar o PDF Executivo.");
        return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const dateFormatted = new Date().toLocaleDateString('pt-BR');

    doc.setFillColor(11, 17, 32);
    doc.rect(0, 0, 297, 210, 'F');
    doc.setFontSize(14); doc.setFont('helvetica', 'bold'); doc.setTextColor(248, 250, 252);
    doc.text("Management Overview - DASHBOARD EXECUTIVO DE PERDAS", 10, 12);

    const canvasList = ['chartPerdaEventos', 'chartPerdaOperacoes', 'chartPerdaCompradores', 'chartPerdaSetores', 'chartPerdaPareto', 'chartPerdaGrupos', 'chartPerdaSubgrupos', 'chartPerdaClasses', 'chartPerdaMaioresAumentos'];
    let pageCount = 0;

    canvasList.forEach((id) => {
        const canvas = document.getElementById(id);
        if (!canvas) return;

        if (pageCount > 0 && pageCount % 4 === 0) {
            doc.addPage();
            doc.setFillColor(11, 17, 32); doc.rect(0, 0, 297, 210, 'F');
        }

        const pos = pageCount % 4;
        const x = (pos % 2 === 0) ? 10 : 150;
        const y = 20 + (Math.floor(pos / 2) * 85);

        try {
            const imgData = canvas.toDataURL('image/png', 1.0);
            doc.setDrawColor(38, 51, 77); doc.setFillColor(19, 29, 49);
            doc.roundedRect(x, y, 137, 80, 2, 2, 'FD');
            doc.addImage(imgData, 'PNG', x + 2, y + 2, 133, 76);
            pageCount++;
        } catch (e) { console.error(e); }
    });

    doc.save(`Dashboard_Executivo_Perdas_${dateFormatted.replace(/\//g, '-')}.pdf`);
}