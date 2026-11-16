/**
 * MÓDULO DE PERDAS - VISÃO DETALHADA POR EVENTO, SINAIS, EMBALAGENS E KPI DE PERDA S/ VENDA
 */

const statePerdas = {
    rawProcessedData: [],
    filteredData: [],
    currentPage: 1,
    pageSize: 100,
    sort: { key: 'diferencaPerdas', direction: 'desc' },
    hiddenColumns: new Set()
};

const elementsPerdas = {};

const PERDAS_KEYWORDS_ATUAL = ['perda_atual', 'perdaatual', 'perda_atu', 'perda atu', 'perdas_atual', 'perdaatual_2', 'perda_atual_2'];
const PERDAS_KEYWORDS_ANTERIOR = ['perda_anterior', 'perdaanterior', 'perda_ant', 'perda ant', 'perdas_anterior', 'perdaanterior_2', 'perda_anterior_2'];

document.addEventListener('DOMContentLoaded', () => {
    initPerdasModule();
});

function initPerdasModule() {
    elementsPerdas.searchProdCod = document.getElementById('searchProdCodPerdas');
    elementsPerdas.searchEmb = document.getElementById('searchEmbPerdas');
    elementsPerdas.filterEvento = document.getElementById('filterEventoPerdas');
    elementsPerdas.filterOperacao = document.getElementById('filterOperacaoPerdas');
    elementsPerdas.filterGrupo = document.getElementById('filterGrupoPerdas');
    elementsPerdas.filterSubgrupo = document.getElementById('filterSubgrupoPerdas');
    elementsPerdas.filterClasse = document.getElementById('filterClassePerdas');
    elementsPerdas.filterComprador = document.getElementById('filterCompradorPerdas');
    elementsPerdas.filterSetorBalanco = document.getElementById('filterSetorBalancoPerdas');
    elementsPerdas.btnClearFilters = document.getElementById('btnClearFiltersPerdas');
    
    elementsPerdas.kpiAnterior = document.getElementById('kpiPerdaAnteriorTotal');
    elementsPerdas.kpiAtual = document.getElementById('kpiPerdaAtualTotal');
    elementsPerdas.kpiDiferenca = document.getElementById('kpiDiferencaPerdasTotal');
    elementsPerdas.kpiPct = document.getElementById('kpiPctEvolucaoPerdasTotal');
    elementsPerdas.kpiPctPerdaVenda = document.getElementById('kpiPctPerdaSobreVenda');
    
    elementsPerdas.tableBody = document.getElementById('perdasTableBody');
    elementsPerdas.btnPrev = document.getElementById('btnPrevPagePerdas');
    elementsPerdas.btnNext = document.getElementById('btnNextPagePerdas');
    elementsPerdas.pageInfo = document.getElementById('pageInfoPerdas');
    elementsPerdas.pageNum = document.getElementById('currentPageNumPerdas');

    // Menu de Ocultar Colunas
    const btnToggleCols = document.getElementById('btnToggleColsPerdas');
    const dropdownCols = document.getElementById('dropdownColsPerdas');

    if (btnToggleCols && dropdownCols) {
        btnToggleCols.addEventListener('click', (e) => {
            e.stopPropagation();
            dropdownCols.classList.toggle('hidden');
        });

        document.addEventListener('click', (e) => {
            if (!dropdownCols.contains(e.target) && e.target !== btnToggleCols) {
                dropdownCols.classList.add('hidden');
            }
        });

        dropdownCols.querySelectorAll('input[type="checkbox"]').forEach(chk => {
            chk.addEventListener('change', (e) => {
                const targetCol = e.target.getAttribute('data-target-perda-col');
                if (e.target.checked) statePerdas.hiddenColumns.delete(targetCol);
                else statePerdas.hiddenColumns.add(targetCol);
                applyPerdasColumnVisibility();
            });
        });
    }

    const folderInput = document.getElementById('folderInput');
    if (folderInput) folderInput.addEventListener('change', handlePerdasFolderSelect);

    const filters = [
        elementsPerdas.searchProdCod, elementsPerdas.searchEmb, 
        elementsPerdas.filterEvento, elementsPerdas.filterOperacao, 
        elementsPerdas.filterGrupo, elementsPerdas.filterSubgrupo, 
        elementsPerdas.filterClasse, elementsPerdas.filterComprador, 
        elementsPerdas.filterSetorBalanco
    ];

    filters.forEach(el => {
        if (el) el.addEventListener('input', () => {
            statePerdas.currentPage = 1;
            applyPerdasFilters();
        });
    });

    if (elementsPerdas.btnClearFilters) elementsPerdas.btnClearFilters.addEventListener('click', clearPerdasFilters);

    if (elementsPerdas.btnPrev) {
        elementsPerdas.btnPrev.addEventListener('click', () => {
            if (statePerdas.currentPage > 1) {
                statePerdas.currentPage--;
                renderPerdasUI();
            }
        });
    }

    if (elementsPerdas.btnNext) {
        elementsPerdas.btnNext.addEventListener('click', () => {
            const maxPages = Math.ceil(statePerdas.filteredData.length / statePerdas.pageSize) || 1;
            if (statePerdas.currentPage < maxPages) {
                statePerdas.currentPage++;
                renderPerdasUI();
            }
        });
    }

    document.querySelectorAll('#tablePerdas th[data-sort-key]').forEach(th => {
        th.addEventListener('click', () => handlePerdasHeaderSort(th.getAttribute('data-sort-key')));
    });

    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const tabId = e.target.getAttribute('data-tab');
            toggleGlobalPaginationForTab(tabId);
            if (tabId === 'tab-perdas') {
                renderPerdasUI();
            }
        });
    });
}

function toggleGlobalPaginationForTab(tabId) {
    const sharedPagination = document.getElementById('sharedPaginationBar');
    if (sharedPagination) {
        if (['tab-perdas', 'tab-pedidos', 'tab-clientes', 'tab-charts'].includes(tabId)) {
            sharedPagination.style.display = 'none';
        } else {
            sharedPagination.style.display = 'flex';
        }
    }
}

function applyPerdasColumnVisibility() {
    const table = document.getElementById('tablePerdas');
    if (!table) return;

    const allClasses = [
        'col-perda-embalagem', 'col-perda-evento', 'col-perda-operacao', 
        'col-perda-ant-emb1', 'col-perda-ant-emb9', 'col-perda-ant-val',
        'col-perda-atu-emb1', 'col-perda-atu-emb9', 'col-perda-atu-val',
        'col-perda-dif', 'col-perda-pct', 
        'col-perda-setor', 'col-perda-comprador', 'col-perda-grupo', 'col-perda-classe'
    ];

    allClasses.forEach(colClass => {
        const isHidden = statePerdas.hiddenColumns.has(colClass);
        table.querySelectorAll(`.${colClass}`).forEach(cell => {
            if (isHidden) cell.classList.add('hidden-col');
            else cell.classList.remove('hidden-col');
        });
    });
}

async function handlePerdasFolderSelect(e) {
    const files = Array.from(e.target.files);
    if (!files.length) return;

    let filePerdaAtual = null;
    let filePerdaAnterior = null;

    files.forEach(file => {
        const nameLower = file.name.toLowerCase();
        if (PERDAS_KEYWORDS_ANTERIOR.some(k => nameLower.includes(k))) filePerdaAnterior = file;
        else if (PERDAS_KEYWORDS_ATUAL.some(k => nameLower.includes(k))) filePerdaAtual = file;
    });

    try {
        let jsonAtual = [];
        let jsonAnterior = [];

        if (filePerdaAtual) jsonAtual = await parseFileToJSONPerdas(filePerdaAtual);
        if (filePerdaAnterior) jsonAnterior = await parseFileToJSONPerdas(filePerdaAnterior);

        if (jsonAtual.length > 0 || jsonAnterior.length > 0) {
            statePerdas.rawProcessedData = processPerdasDataDetailed(jsonAtual, jsonAnterior);
            statePerdas.filteredData = [...statePerdas.rawProcessedData];
            populatePerdasRichDropdowns();
            applyPerdasFilters();
        }
    } catch (err) {
        console.error("Erro ao carregar arquivos de perda:", err);
    }
}

function parseFileToJSONPerdas(file) {
    return new Promise((resolve, reject) => {
        const isCsv = file.name.toLowerCase().endsWith('.csv') || file.name.toLowerCase().endsWith('.txt');
        const reader = new FileReader();

        reader.onload = (e) => {
            try {
                let workbook;
                if (isCsv) workbook = XLSX.read(e.target.result, { type: 'string', raw: true });
                else workbook = XLSX.read(new Uint8Array(e.target.result), { type: 'array', raw: true });
                const firstSheet = workbook.SheetNames[0];
                const json = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheet], { defval: "" });
                resolve(json);
            } catch (err) { reject(err); }
        };
        reader.onerror = reject;

        if (isCsv) reader.readAsText(file, 'ISO-8859-1');
        else reader.readAsArrayBuffer(file);
    });
}

function parseBRNumberSigned(val) {
    if (val === null || val === undefined || val === '') return 0;
    if (typeof val === 'number') return val;
    let str = String(val).trim();
    let isNegative = str.includes('-');
    str = str.replace(/[^0-9,/]/g, '').replace(',', '.');
    const num = parseFloat(str);
    if (isNaN(num)) return 0;
    return isNegative ? -num : num;
}

function sanitizeCode(raw) {
    if (!raw) return '';
    let str = String(raw).trim();
    if (str.includes('-')) str = str.split('-')[0].trim();
    return str.replace(/[^a-zA-Z0-9]/g, '').replace(/^0+/, '') || '0';
}

function processPerdasDataDetailed(jsonAtual, jsonAnterior) {
    const mapAtual = new Map();
    const mapAnterior = new Map();
    const detailsMap = new Map();

    jsonAtual.forEach(row => {
        const rawMerc = row['MERCADORIA'] || row['MERCADOR'] || row['MERC'] || row['Código'] || '';
        if (!rawMerc) return;
        
        const codeKey = sanitizeCode(rawMerc);
        const eventoStr = row['EVENTO'] !== undefined && row['EVENTO'] !== "" ? String(row['EVENTO']).trim() : 'N/A';
        const operacaoStr = row['OPERACAO'] || row['OPERAÇÃO'] || 'N/A';
        
        const compositeKey = `${codeKey}_${eventoStr}_${operacaoStr}`;
        const valorRaw = parseBRNumberSigned(row['VLR.TOTAL'] || row['VLR_TOTAL'] || 0);
        const emb1 = parseBRNumberSigned(row['EMB1'] || 0);
        const emb9 = parseBRNumberSigned(row['EMB9'] || 0);

        if (!mapAtual.has(compositeKey)) {
            mapAtual.set(compositeKey, { valor: 0, emb1: 0, emb9: 0 });
        }
        const curr = mapAtual.get(compositeKey);
        curr.valor += valorRaw;
        curr.emb1 += emb1;
        curr.emb9 += emb9;

        if (!detailsMap.has(compositeKey)) {
            detailsMap.set(compositeKey, {
                codigoCompleto: String(rawMerc).trim(),
                descricao: row['DESCRICAO'] || 'Produto Sem Descrição',
                embalagem: row['EMBALAGEM'] || '-',
                evento: eventoStr,
                operacao: operacaoStr,
                grupo: row['GRUPO'] || 'N/A',
                subgrupo: row['SUB-GRUPO'] || row['SUBGRUPO'] || 'N/A',
                classe: row['CLASSE'] || 'N/A',
                comprador: row['COMPRADOR'] || 'N/A',
                setorBalanco: row['SETOR BALANCO'] || row['SETOR_BALANCO'] || 'N/A'
            });
        }
    });

    jsonAnterior.forEach(row => {
        const rawMerc = row['MERCADORIA'] || row['MERCADOR'] || row['MERC'] || row['Código'] || '';
        if (!rawMerc) return;

        const codeKey = sanitizeCode(rawMerc);
        const eventoStr = row['EVENTO'] !== undefined && row['EVENTO'] !== "" ? String(row['EVENTO']).trim() : 'N/A';
        const operacaoStr = row['OPERACAO'] || row['OPERAÇÃO'] || 'N/A';
        
        const compositeKey = `${codeKey}_${eventoStr}_${operacaoStr}`;
        const valorRaw = parseBRNumberSigned(row['VLR.TOTAL'] || row['VLR_TOTAL'] || 0);
        const emb1 = parseBRNumberSigned(row['EMB1'] || 0);
        const emb9 = parseBRNumberSigned(row['EMB9'] || 0);

        if (!mapAnterior.has(compositeKey)) {
            mapAnterior.set(compositeKey, { valor: 0, emb1: 0, emb9: 0 });
        }
        const curr = mapAnterior.get(compositeKey);
        curr.valor += valorRaw;
        curr.emb1 += emb1;
        curr.emb9 += emb9;

        if (!detailsMap.has(compositeKey)) {
            detailsMap.set(compositeKey, {
                codigoCompleto: String(rawMerc).trim(),
                descricao: row['DESCRICAO'] || 'Produto Sem Descrição',
                embalagem: row['EMBALAGEM'] || '-',
                evento: eventoStr,
                operacao: operacaoStr,
                grupo: row['GRUPO'] || 'N/A',
                subgrupo: row['SUB-GRUPO'] || row['SUBGRUPO'] || 'N/A',
                classe: row['CLASSE'] || 'N/A',
                comprador: row['COMPRADOR'] || 'N/A',
                setorBalanco: row['SETOR BALANCO'] || row['SETOR_BALANCO'] || 'N/A'
            });
        }
    });

    const allKeys = new Set([...mapAtual.keys(), ...mapAnterior.keys()]);
    const resultList = [];

    allKeys.forEach(compositeKey => {
        const det = detailsMap.get(compositeKey) || {};
        
        const objAnt = mapAnterior.get(compositeKey) || { valor: 0, emb1: 0, emb9: 0 };
        const objAtu = mapAtual.get(compositeKey) || { valor: 0, emb1: 0, emb9: 0 };

        const pAnt = objAnt.valor;
        const pAtu = objAtu.valor;
        const dif = pAtu - pAnt;

        let pct = 0;
        if (Math.abs(pAnt) > 0) pct = (dif / Math.abs(pAnt)) * 100;
        else if (Math.abs(pAtu) > 0) pct = 100;

        resultList.push({
            id: compositeKey,
            codigoCompleto: det.codigoCompleto || compositeKey,
            descricao: det.descricao || 'Produto Sem Descrição',
            embalagem: det.embalagem || '-',
            evento: det.evento || 'N/A',
            operacao: det.operacao || 'N/A',
            grupo: det.grupo || 'N/A',
            subgrupo: det.subgrupo || 'N/A',
            grupoSubgrupo: `${det.grupo || 'N/A'} / ${det.subgrupo || 'N/A'}`,
            classe: det.classe || 'N/A',
            comprador: det.comprador || 'N/A',
            setorBalanco: det.setorBalanco || 'N/A',
            
            emb1Anterior: objAnt.emb1,
            emb9Anterior: objAnt.emb9,
            perdaAnterior: pAnt,
            
            emb1Atual: objAtu.emb1,
            emb9Atual: objAtu.emb9,
            perdaAtual: pAtu,
            
            diferencaPerdas: dif,
            pctEvolucaoPerdas: pct
        });
    });

    return resultList;
}

function populatePerdasRichDropdowns() {
    const data = statePerdas.rawProcessedData;

    const buildRichOptions = (el, fieldKey, titlePlaceholder) => {
        if (!el) return;
        const mapCategory = new Map();

        data.forEach(item => {
            const val = item[fieldKey];
            if (!val || val === 'N/A') return;
            mapCategory.set(val, (mapCategory.get(val) || 0) + item.diferencaPerdas);
        });

        const sortedCategories = Array.from(mapCategory.entries()).sort((a, b) => b[1] - a[1]);

        el.innerHTML = `<option value="">${titlePlaceholder}</option>`;
        sortedCategories.forEach(([catName, difSum]) => {
            const opt = document.createElement('option');
            opt.value = catName;
            const sinal = difSum > 0 ? '+' : '';
            const valFmt = `${sinal}${difSum.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`;
            opt.textContent = `${catName} (${valFmt})`;
            el.appendChild(opt);
        });
    };

    buildRichOptions(elementsPerdas.filterEvento, 'evento', 'Evento (Todos)');
    buildRichOptions(elementsPerdas.filterOperacao, 'operacao', 'Operação (Todas)');
    buildRichOptions(elementsPerdas.filterGrupo, 'grupo', 'Grupo (Todos)');
    buildRichOptions(elementsPerdas.filterSubgrupo, 'subgrupo', 'Subgrupo (Todos)');
    buildRichOptions(elementsPerdas.filterClasse, 'classe', 'Classe (Todas)');
    buildRichOptions(elementsPerdas.filterComprador, 'comprador', 'Comprador (Todos)');
    buildRichOptions(elementsPerdas.filterSetorBalanco, 'setorBalanco', 'Setor Balanço (Todos)');
}

function handlePerdasHeaderSort(key) {
    if (statePerdas.sort.key === key) {
        statePerdas.sort.direction = statePerdas.sort.direction === 'asc' ? 'desc' : 'asc';
    } else {
        statePerdas.sort.key = key;
        statePerdas.sort.direction = 'desc';
    }
    
    document.querySelectorAll('#tablePerdas th[data-sort-key]').forEach(th => {
        th.classList.remove('sort-asc', 'sort-desc');
        if (th.getAttribute('data-sort-key') === statePerdas.sort.key) {
            th.classList.add(statePerdas.sort.direction === 'asc' ? 'sort-asc' : 'sort-desc');
        }
    });

    applyPerdasSort();
    renderPerdasUI();
}

function applyPerdasSort() {
    const { key, direction } = statePerdas.sort;
    const multiplier = direction === 'asc' ? 1 : -1;

    statePerdas.filteredData.sort((a, b) => {
        let valA = a[key] ?? '';
        let valB = b[key] ?? '';

        if (typeof valA === 'number' && typeof valB === 'number') {
            return (valA - valB) * multiplier;
        }
        return String(valA).localeCompare(String(valB), 'pt-BR', { numeric: true, sensitivity: 'base' }) * multiplier;
    });
}

function clearPerdasFilters() {
    if (elementsPerdas.searchProdCod) elementsPerdas.searchProdCod.value = '';
    if (elementsPerdas.searchEmb) elementsPerdas.searchEmb.value = '';
    if (elementsPerdas.filterEvento) elementsPerdas.filterEvento.value = '';
    if (elementsPerdas.filterOperacao) elementsPerdas.filterOperacao.value = '';
    if (elementsPerdas.filterGrupo) elementsPerdas.filterGrupo.value = '';
    if (elementsPerdas.filterSubgrupo) elementsPerdas.filterSubgrupo.value = '';
    if (elementsPerdas.filterClasse) elementsPerdas.filterClasse.value = '';
    if (elementsPerdas.filterComprador) elementsPerdas.filterComprador.value = '';
    if (elementsPerdas.filterSetorBalanco) elementsPerdas.filterSetorBalanco.value = '';
    
    statePerdas.sort.key = 'diferencaPerdas';
    statePerdas.sort.direction = 'desc';
    statePerdas.currentPage = 1;
    applyPerdasFilters();
}

function applyPerdasFilters() {
    const searchRaw = elementsPerdas.searchProdCod ? elementsPerdas.searchProdCod.value.toLowerCase().trim() : '';
    const embRaw = elementsPerdas.searchEmb ? elementsPerdas.searchEmb.value.toLowerCase().trim() : '';
    
    const fEvento = elementsPerdas.filterEvento ? elementsPerdas.filterEvento.value : '';
    const fOperacao = elementsPerdas.filterOperacao ? elementsPerdas.filterOperacao.value : '';
    const fGrupo = elementsPerdas.filterGrupo ? elementsPerdas.filterGrupo.value : '';
    const fSubgrupo = elementsPerdas.filterSubgrupo ? elementsPerdas.filterSubgrupo.value : '';
    const fClasse = elementsPerdas.filterClasse ? elementsPerdas.filterClasse.value : '';
    const fComprador = elementsPerdas.filterComprador ? elementsPerdas.filterComprador.value : '';
    const fSetor = elementsPerdas.filterSetorBalanco ? elementsPerdas.filterSetorBalanco.value : '';

    statePerdas.filteredData = statePerdas.rawProcessedData.filter(item => {
        const textToSearch = `${item.codigoCompleto} ${item.descricao}`.toLowerCase();
        const matchSearch = !searchRaw || textToSearch.includes(searchRaw);
        const matchEmb = !embRaw || (item.embalagem || '').toLowerCase().includes(embRaw);

        const matchEvento = !fEvento || item.evento === fEvento;
        const matchOperacao = !fOperacao || item.operacao === fOperacao;
        const matchGrupo = !fGrupo || item.grupo === fGrupo;
        const matchSubgrupo = !fSubgrupo || item.subgrupo === fSubgrupo;
        const matchClasse = !fClasse || item.classe === fClasse;
        const matchComprador = !fComprador || item.comprador === fComprador;
        const matchSetor = !fSetor || item.setorBalanco === fSetor;

        return matchSearch && matchEmb && matchEvento && matchOperacao && matchGrupo && matchSubgrupo && matchClasse && matchComprador && matchSetor;
    });

    applyPerdasSort();
    renderPerdasUI();
}

function formatValueWithSign(val) {
    if (val === 0) return 'R$ 0,00';
    const absVal = Math.abs(val).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    return val > 0 ? `+${absVal}` : `-${absVal}`;
}

function formatQtyWithSign(qty, unit) {
    if (qty === 0) return `0 ${unit}`;
    return `${qty > 0 ? '+' : ''}${qty.toLocaleString('pt-BR')} ${unit}`;
}

function renderPerdasUI() {
    const totalAnterior = statePerdas.filteredData.reduce((sum, i) => sum + i.perdaAnterior, 0);
    const totalAtual = statePerdas.filteredData.reduce((sum, i) => sum + i.perdaAtual, 0);
    const totalDif = totalAtual - totalAnterior;
    
    let totalPct = 0;
    if (Math.abs(totalAnterior) > 0) totalPct = (totalDif / Math.abs(totalAnterior)) * 100;
    else if (Math.abs(totalAtual) > 0) totalPct = 100;

    // Busca a venda total do estado global do script principal
    let totalVendaAtual = 0;
    if (typeof window.state !== 'undefined' && Array.isArray(window.state.rawProcessedData) && window.state.rawProcessedData.length > 0) {
        totalVendaAtual = window.state.rawProcessedData.reduce((sum, item) => sum + (item.vendaAtual || 0), 0);
    } else if (typeof state !== 'undefined' && Array.isArray(state.rawProcessedData) && state.rawProcessedData.length > 0) {
        totalVendaAtual = state.rawProcessedData.reduce((sum, item) => sum + (item.vendaAtual || 0), 0);
    }

    // Porcentagem de Perda s/ Venda
    let pctPerdaSobreVenda = 0;
    if (totalVendaAtual > 0) {
        pctPerdaSobreVenda = (Math.abs(totalAtual) / totalVendaAtual) * 100;
    }

    if (elementsPerdas.kpiAnterior) {
        elementsPerdas.kpiAnterior.textContent = formatValueWithSign(totalAnterior);
    }
    
    if (elementsPerdas.kpiAtual) {
        elementsPerdas.kpiAtual.textContent = formatValueWithSign(totalAtual);
    }
    
    if (elementsPerdas.kpiDiferenca) {
        const difFormat = formatValueWithSign(totalDif);
        elementsPerdas.kpiDiferenca.textContent = difFormat;
        elementsPerdas.kpiDiferenca.style.color = totalDif > 0 ? 'var(--status-success)' : 'var(--status-critical)';
    }

    if (elementsPerdas.kpiPct) {
        const pctFormat = `${totalPct > 0 ? '+' : ''}${totalPct.toFixed(2)}%`;
        elementsPerdas.kpiPct.textContent = pctFormat;
        elementsPerdas.kpiPct.style.color = totalPct > 0 ? 'var(--status-success)' : 'var(--status-critical)';
    }

    if (elementsPerdas.kpiPctPerdaVenda) {
        elementsPerdas.kpiPctPerdaVenda.textContent = `${pctPerdaSobreVenda.toFixed(2)}%`;
        elementsPerdas.kpiPctPerdaVenda.style.color = pctPerdaSobreVenda > 2 ? 'var(--status-critical)' : 'var(--text-main)';
    }

    toggleGlobalPaginationForTab('tab-perdas');

    // Paginação
    const total = statePerdas.filteredData.length;
    const maxPages = Math.ceil(total / statePerdas.pageSize) || 1;
    if (statePerdas.currentPage > maxPages) statePerdas.currentPage = maxPages;

    const startIdx = (statePerdas.currentPage - 1) * statePerdas.pageSize;
    const endIdx = Math.min(startIdx + statePerdas.pageSize, total);
    const pageItems = statePerdas.filteredData.slice(startIdx, endIdx);

    if (elementsPerdas.pageInfo) elementsPerdas.pageInfo.textContent = `Exibindo ${total === 0 ? 0 : startIdx + 1} até ${endIdx} de ${total.toLocaleString('pt-BR')} registros de eventos`;
    if (elementsPerdas.pageNum) elementsPerdas.pageNum.textContent = `Pág ${statePerdas.currentPage} / ${maxPages}`;
    if (elementsPerdas.btnPrev) elementsPerdas.btnPrev.disabled = statePerdas.currentPage <= 1;
    if (elementsPerdas.btnNext) elementsPerdas.btnNext.disabled = statePerdas.currentPage >= maxPages;

    if (!elementsPerdas.tableBody) return;

    if (pageItems.length === 0) {
        elementsPerdas.tableBody.innerHTML = `<tr><td colspan="16" class="empty-state">Nenhum registro de evento encontrado para os filtros selecionados.</td></tr>`;
        return;
    }

    elementsPerdas.tableBody.innerHTML = pageItems.map(item => {
    // Sobras (valores positivos) = Verde | Faltas/Perdas (valores negativos) = Vermelho
    const getValColor = (val) => {
        if (val > 0) return 'color: #22c55e; font-weight: 700;'; // Verde (Sobra)
        if (val < 0) return 'color: #ef4444; font-weight: 700;'; // Vermelho (Falta/Perda)
        return 'color: var(--text-main);';                      // Neutro (Zero)
    };

    const sinalDif = item.diferencaPerdas > 0 ? '+' : '';
    const sinalPct = item.pctEvolucaoPerdas > 0 ? '+' : '';

    return `
    <tr>
        <td>
            <strong>${item.descricao}</strong>
            <span class="sub-text">Cód: ${item.codigoCompleto}</span>
        </td>
        <td class="col-perda-embalagem">${item.embalagem}</td>
        <td class="col-perda-evento">${item.evento}</td>
        <td class="col-perda-operacao">${item.operacao}</td>
        
        <td class="col-perda-ant-emb1">${formatQtyWithSign(item.emb1Anterior, 'CX')}</td>
        <td class="col-perda-ant-emb9">${formatQtyWithSign(item.emb9Anterior, 'UN')}</td>
        <td class="col-perda-ant-val" style="${getValColor(item.perdaAnterior)}">${formatValueWithSign(item.perdaAnterior)}</td>
        
        <td class="col-perda-atu-emb1">${formatQtyWithSign(item.emb1Atual, 'CX')}</td>
        <td class="col-perda-atu-emb9">${formatQtyWithSign(item.emb9Atual, 'UN')}</td>
        <td class="col-perda-atu-val" style="${getValColor(item.perdaAtual)}">${formatValueWithSign(item.perdaAtual)}</td>
        
        <td class="col-perda-dif" style="${getValColor(item.diferencaPerdas)}">${sinalDif}${item.diferencaPerdas.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
        <td class="col-perda-pct" style="${getValColor(item.pctEvolucaoPerdas)}">${sinalPct}${item.pctEvolucaoPerdas.toFixed(2)}%</td>
        
        <td class="col-perda-setor">${item.setorBalanco}</td>
        <td class="col-perda-comprador">${item.comprador}</td>
        <td class="col-perda-grupo">${item.grupoSubgrupo}</td>
        <td class="col-perda-classe">${item.classe}</td>
    </tr>
    `;
}).join('');

    applyPerdasColumnVisibility();
}