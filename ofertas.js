// =============================================================================
// ABA OFERTAS - Conferência de preços de ações promocionais
// -----------------------------------------------------------------------------
// Fluxo:
//   1) O usuário copia as células do Excel (código + preço, com ou sem
//      cabeçalho e com quaisquer outras colunas) e cola no modal.
//   2) O sistema detecta sozinho a coluna de Código e a de Preço (o usuário
//      pode trocar nos seletores) e mostra uma prévia da leitura.
//   3) Os itens são cruzados com a base da Dashboard (state.rawProcessedData)
//      e o preço da oferta é comparado com o preço praticado:
//         - Itens de KG (embalagem contém "KG")  -> compara com Preço Cx.
//         - Demais itens                         -> compara com Preço Und.
// Depende de script.js (state, sanitizeProductCode, syncColumnVisibility).
// =============================================================================
(function () {
    'use strict';

    const ofertasState = {
        matrix: [],            // dados colados (linhas x colunas)
        colCodigo: -1,         // índice da coluna de código escolhida
        colPreco: -1,          // índice da coluna de preço escolhida
        pendingOffers: [],     // ofertas lidas no modal (antes de aplicar)
        offers: [],            // ofertas aplicadas [{ id, codigoDigitado, preco }]
        rows: [],              // ofertas cruzadas com a base
        filterTipo: '',
        filterComprador: '',
        onlyStock: false,      // chave "Somente com Estoque"
        search: '',            // busca por código ou descrição
        onlyBloq: false,       // chave "Produtos Bloqueados" (Preço Fixo = S)
        filterAcao: '',        // filtro por nome da ação
        selected: new Set(),   // ids das linhas marcadas (caixinha)
        clienteDates: { ini: '', fim: '' },
        sort: { key: null, direction: 'asc' },
        vendaDia: { map: new Map(), status: 'sem_arquivo', dateLabel: '', fileName: '', origin: '' }
    };

    const $ = (id) => document.getElementById(id);

    // ------------------------------------------------------------- persistência
    // Ofertas ficam salvas no navegador (localStorage) e só somem com "Limpar Dados".
    const LS_OFERTAS = 'mo_ofertas_v1';
    let ofertasUltimoSalvo = '';
    let ofertasRestaurado = false;

    function salvarOfertas() {
        if (!ofertasRestaurado) return;
        try {
            const json = JSON.stringify({ offers: ofertasState.offers, clienteDates: ofertasState.clienteDates });
            if (json === ofertasUltimoSalvo) return;
            localStorage.setItem(LS_OFERTAS, json);
            ofertasUltimoSalvo = json;
        } catch (e) { /* armazenamento indisponível: segue sem salvar */ }
    }

    function restaurarOfertas() {
        try {
            const raw = localStorage.getItem(LS_OFERTAS);
            if (raw) {
                const d = JSON.parse(raw);
                if (d && Array.isArray(d.offers)) {
                    ofertasState.offers = d.offers.filter(o => o && o.key && o.id !== undefined);
                    if (d.clienteDates) ofertasState.clienteDates = d.clienteDates;
                    ofertasUltimoSalvo = raw;
                }
            }
        } catch (e) { /* dados corrompidos: ignora */ }
        ofertasRestaurado = true;
    }

    // ------------------------------------------------------------------ utils
    function esc(v) {
        return String(v === null || v === undefined ? '' : v).replace(/[&<>"']/g, ch => (
            { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
        ));
    }

    // Mesmo padrão visual da Dashboard (R$ 12.90)
    function fmtTabela(v) {
        return `R$ ${Number(v || 0).toFixed(2)}`;
    }

    // Padrão brasileiro para o PDF (R$ 1.234,56)
    function fmtPdf(v) {
        return 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function colLetter(i) {
        let n = i + 1, s = '';
        while (n > 0) {
            const m = (n - 1) % 26;
            s = String.fromCharCode(65 + m) + s;
            n = Math.floor((n - 1) / 26);
        }
        return s;
    }

    // ---------------------------------------------------------------- rentabilidade
    // Cabeçalho padrão (%) descontado da margem bruta. Na fórmula ele se anula no resultado
    // final, mas é mantido para seguir exatamente a estrutura da fórmula do Excel/VBA.
    const RENT_CABECALHO = 7;

    // Rentabilidade (%) que o produto passa a ter se for vendido a precoN.
    //   margem(p) = ((custo / p) * 100 - 100) * -1          (margem bruta % ao preço p)
    //   outros    = (margem(preço atual) - cabeçalho) - rentAtual
    //   rent nova = (margem(precoN) - cabeçalho) - outros
    // custo e preço devem estar na MESMA unidade (a razão custo/preço não muda entre CX e UN).
    // Obs.: a fórmula do VBA, como foi descrita, tem Preço e PreçoN em posições invertidas
    // (a rentabilidade subiria ao baixar o preço). Aqui o preço negociado entra no 1º termo.
    function calcRentabilidadeNegociada(custo, preco, precoN, rentAtual, cabecalho) {
        if (!(custo > 0) || !(preco > 0) || !(precoN > 0)) return null;
        const cab = cabecalho === undefined ? RENT_CABECALHO : cabecalho;
        const margemAtual = ((custo / preco) * 100 - 100) * -1;
        const margemNeg = ((custo / precoN) * 100 - 100) * -1;
        return (margemNeg - cab) - ((margemAtual - cab) - (rentAtual || 0));
    }
    window.calcRentabilidadeNegociada = calcRentabilidadeNegociada;

    // Aceita: "12,90" | "12.90" | "1.234,56" | "R$ 12,90" | 12.9 (número)
    function parseOfertaPreco(raw) {
        if (raw === null || raw === undefined) return null;
        let s = String(raw).trim();
        if (!s) return null;
        s = s.replace(/R\$\s*/gi, '').replace(/\s/g, '');
        if (!/^\d[\d.,]*$/.test(s)) return null;

        const lastComma = s.lastIndexOf(',');
        const lastDot = s.lastIndexOf('.');

        if (lastComma > -1 && lastDot > -1) {
            if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
            else s = s.replace(/,/g, '');
        } else if (lastComma > -1) {
            s = (s.match(/,/g) || []).length > 1 ? s.replace(/,/g, '') : s.replace(',', '.');
        } else if (lastDot > -1) {
            if (/^[1-9]\d{0,2}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
        }

        const n = parseFloat(s);
        return isFinite(n) && n > 0 ? n : null;
    }

    window.ofertasParsePreco = parseOfertaPreco;

    // Aceita: "12345" | "012345" | "12345-6" | "12345 ARROZ" ; recusa textos sem número (cabeçalhos)
    function parseOfertaCodigo(raw) {
        if (raw === null || raw === undefined) return null;
        let s = String(raw).trim();
        if (!s) return null;
        s = s.split(/\s+/)[0];
        if (!/^[0-9A-Za-z][0-9A-Za-z\-_]*$/.test(s) || !/\d/.test(s)) return null;
        const id = sanitizeProductCode(s);
        if (!id || id === '0') return null;
        return { id: id, raw: s };
    }

    // Nomes das ações já importadas (sem repetir, ignorando maiúsculas/acentos)
    function listaAcoes() {
        const m = new Map();
        ofertasState.offers.forEach(o => {
            const k = normTxt(o.acao);
            if (!m.has(k)) m.set(k, o.acao);
        });
        return Array.from(m.values());
    }

    function normTxt(v) {
        return String(v === null || v === undefined ? '' : v).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    }

    function getBaseMap() {
        const map = new Map();
        (state.rawProcessedData || []).forEach(item => {
            if (!map.has(item.id)) map.set(item.id, item);
        });
        return map;
    }

    // ------------------------------------------------------ leitura do "colar"
    function parsePastedText(text) {
        const lines = String(text).replace(/\r/g, '').split('\n');
        while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
        if (!lines.length) return [];

        const hasTab = lines.some(l => l.includes('\t'));
        const hasSemi = !hasTab && lines.some(l => l.includes(';'));

        const clean = (c) => c.trim().replace(/^"([\s\S]*)"$/, '$1').trim();
        const splitWith = (l, mode) => {
            if (mode === 'tab') return l.split('\t');
            if (mode === 'semi') return l.split(';');
            if (mode === 'gap') return l.split(/\s{2,}/);
            return l.split(/\s+/);
        };

        let mode = hasTab ? 'tab' : (hasSemi ? 'semi' : 'gap');
        let matrix = lines.map(l => splitWith(l, mode).map(clean));

        // Sem separadores claros: tenta separar por espaços simples
        if (mode === 'gap' && matrix.every(r => r.length <= 1)) {
            matrix = lines.map(l => splitWith(l, 'space').map(clean));
        }

        return matrix.filter(r => r.some(c => c !== ''));
    }

    // Descobre sozinho a coluna de código (a que mais bate com a base) e a de preço
    function autoDetectColumns(matrix) {
        const nCols = matrix.reduce((m, r) => Math.max(m, r.length), 0);
        if (!nCols) return { code: -1, price: -1 };

        const baseIds = new Set((state.rawProcessedData || []).map(i => i.id));
        const hasBase = baseIds.size > 0;
        const stats = [];

        for (let c = 0; c < nCols; c++) {
            let codeLike = 0, codeMatch = 0, priceDec = 0, priceAny = 0;
            matrix.forEach(r => {
                const cell = r[c];
                if (cell === undefined || cell === '') return;
                const cod = parseOfertaCodigo(cell);
                if (cod) {
                    codeLike++;
                    if (hasBase && baseIds.has(cod.id)) codeMatch++;
                }
                if (parseOfertaPreco(cell) !== null) {
                    priceAny++;
                    if (/[.,]|R\$/.test(String(cell))) priceDec++;
                }
            });
            stats.push({ codeLike, codeMatch, priceDec, priceAny });
        }

        let code = -1;
        let bestMatch = 0;
        stats.forEach((s, i) => { if (s.codeMatch > bestMatch) { bestMatch = s.codeMatch; code = i; } });
        if (code === -1) {
            let bestLike = 0;
            stats.forEach((s, i) => { if (s.codeLike > bestLike) { bestLike = s.codeLike; code = i; } });
        }

        let price = -1;
        let bestScore = -1;
        stats.forEach((s, i) => {
            if (i === code) return;
            const score = s.priceDec * 1000 + s.priceAny;   // prefere colunas com casas decimais
            if (score > 0 && score >= bestScore) { bestScore = score; price = i; } // empate: mais à direita
        });
        if (price === -1) price = stats.findIndex((_, i) => i !== code);

        return { code, price };
    }

    function extractOffers(matrix, cCode, cPrice) {
        const map = new Map();
        let ignored = 0, dup = 0;
        matrix.forEach(r => {
            const cod = parseOfertaCodigo(r[cCode]);
            const pr = parseOfertaPreco(r[cPrice]);
            if (!cod || pr === null) {
                if (r.some(x => String(x || '').trim() !== '')) ignored++;
                return;
            }
            if (map.has(cod.id)) dup++;
            map.set(cod.id, { id: cod.id, codigoDigitado: cod.raw, preco: pr });
        });
        return { offers: Array.from(map.values()), ignored: ignored, dup: dup };
    }

    // ------------------------------------------------------------------ modal
    function openPasteModal() {
        ofertasState.matrix = [];
        ofertasState.pendingOffers = [];
        $('ofertasPasteArea').value = '';
        $('ofertasAcaoNome').value = '';
        $('ofertasAcoesList').innerHTML = listaAcoes().map(a => `<option value="${esc(a)}"></option>`).join('');
        $('ofertasMapSection').classList.add('hidden');
        $('btnOfertasPasteApply').disabled = true;
        $('modalOfertasPaste').classList.remove('hidden');
        $('ofertasPasteArea').focus();
    }

    function closePasteModal() {
        $('modalOfertasPaste').classList.add('hidden');
    }

    function onPasteChanged() {
        const matrix = parsePastedText($('ofertasPasteArea').value);
        ofertasState.matrix = matrix;

        if (!matrix.length) {
            $('ofertasMapSection').classList.add('hidden');
            $('btnOfertasPasteApply').disabled = true;
            return;
        }

        const nCols = matrix.reduce((m, r) => Math.max(m, r.length), 0);
        const det = autoDetectColumns(matrix);
        ofertasState.colCodigo = det.code;
        ofertasState.colPreco = det.price;

        const sample = (c) => {
            for (let i = 0; i < Math.min(matrix.length, 12); i++) {
                const v = matrix[i][c];
                if (v) return String(v).slice(0, 14);
            }
            return '';
        };
        const optionsHtml = Array.from({ length: nCols }, (_, c) =>
            `<option value="${c}">Coluna ${colLetter(c)}${sample(c) ? ' — ex.: ' + esc(sample(c)) : ''}</option>`
        ).join('');

        $('selOfertasColCodigo').innerHTML = optionsHtml;
        $('selOfertasColPreco').innerHTML = optionsHtml;
        if (det.code >= 0) $('selOfertasColCodigo').value = String(det.code);
        if (det.price >= 0) $('selOfertasColPreco').value = String(det.price);

        $('ofertasMapSection').classList.remove('hidden');
        refreshPreview();
    }

    function onMappingChanged() {
        ofertasState.colCodigo = parseInt($('selOfertasColCodigo').value, 10);
        ofertasState.colPreco = parseInt($('selOfertasColPreco').value, 10);
        refreshPreview();
    }

    function refreshPreview() {
        const matrix = ofertasState.matrix;
        const cCode = ofertasState.colCodigo;
        const cPrice = ofertasState.colPreco;
        const nCols = matrix.reduce((m, r) => Math.max(m, r.length), 0);
        const base = getBaseMap();
        const hasBase = base.size > 0;

        const result = extractOffers(matrix, cCode, cPrice);
        ofertasState.pendingOffers = result.offers;

        // Prévia: começa uma linha antes da primeira linha válida (para mostrar o cabeçalho)
        const firstValid = matrix.findIndex(r => parseOfertaCodigo(r[cCode]) && parseOfertaPreco(r[cPrice]) !== null);
        const start = Math.max(0, firstValid - 1);
        const preview = matrix.slice(start, start + 8);

        let head = '<tr><th>#</th>';
        for (let c = 0; c < nCols; c++) {
            const cls = c === cCode ? 'ofertas-col-code' : (c === cPrice ? 'ofertas-col-price' : '');
            const tag = c === cCode ? ' (Código)' : (c === cPrice ? ' (Preço)' : '');
            head += `<th class="${cls}">${colLetter(c)}${tag}</th>`;
        }
        head += '<th>Leitura</th></tr>';

        const body = preview.map((r, i) => {
            const cod = parseOfertaCodigo(r[cCode]);
            const pr = parseOfertaPreco(r[cPrice]);
            let status;
            if (cod && pr !== null) {
                const it = base.get(cod.id);
                status = it
                    ? `<span class="ofertas-ok">✔ ${fmtTabela(pr)}</span> <span class="ofertas-prev-desc">${esc(String(it.descricao).slice(0, 30))}</span>`
                    : `<span class="ofertas-warn">✔ ${fmtTabela(pr)}</span> <span class="ofertas-prev-desc">${hasBase ? '⚠ não encontrado na base' : ''}</span>`;
            } else {
                status = '<span class="ofertas-muted">— ignorada</span>';
            }
            let cells = '';
            for (let c = 0; c < nCols; c++) {
                const cls = c === cCode ? 'ofertas-col-code' : (c === cPrice ? 'ofertas-col-price' : '');
                cells += `<td class="${cls}">${esc(r[c] === undefined ? '' : r[c])}</td>`;
            }
            return `<tr><td class="ofertas-rownum">${start + i + 1}</td>${cells}<td>${status}</td></tr>`;
        }).join('');

        $('ofertasPreviewTable').innerHTML = `<thead>${head}</thead><tbody>${body}</tbody>`;

        const notFound = hasBase ? result.offers.filter(o => !base.has(o.id)).length : 0;
        let summary = `<strong>${result.offers.length}</strong> itens válidos`;
        if (result.ignored) summary += ` · ${result.ignored} linhas ignoradas (cabeçalho/vazias)`;
        if (result.dup) summary += ` · ${result.dup} códigos repetidos (mantido o último preço)`;
        if (hasBase) summary += notFound ? ` · <span class="ofertas-warn">${notFound} não encontrados na base</span>` : ' · todos encontrados na base';
        else summary += ' · <span class="ofertas-warn">⚠ base não carregada: selecione a pasta de dados para conferir</span>';
        if (ofertasState.offers.length) summary += ` · já há ${ofertasState.offers.length.toLocaleString('pt-BR')} itens importados: estes serão acrescentados`;
        $('ofertasPasteSummary').innerHTML = summary;

        $('btnOfertasPasteApply').disabled = result.offers.length === 0;
    }

    // Acrescenta as ofertas lidas à lista atual, vinculadas ao nome da ação informado.
    // Mesmo produto na MESMA ação = atualiza o preço; em ações diferentes = linhas separadas.
    function applyPaste() {
        if (!ofertasState.pendingOffers.length) return;

        const nome = $('ofertasAcaoNome').value.trim();
        if (!nome) {
            alert('Informe o nome da ação desta oferta (campo abaixo da caixa de colagem).');
            $('ofertasAcaoNome').focus();
            return;
        }

        const acaoKey = normTxt(nome);
        const existente = ofertasState.offers.find(o => normTxt(o.acao) === acaoKey);
        const acaoNome = existente ? existente.acao : nome;

        const idx = new Map(ofertasState.offers.map((o, i) => [o.key, i]));
        ofertasState.pendingOffers.forEach(p => {
            const key = acaoKey + '\u0001' + p.id;
            const obj = { key: key, id: p.id, codigoDigitado: p.codigoDigitado, preco: p.preco, acao: acaoNome };
            if (idx.has(key)) {
                ofertasState.offers[idx.get(key)] = obj;
            } else {
                idx.set(key, ofertasState.offers.length);
                ofertasState.offers.push(obj);
            }
        });

        closePasteModal();
        renderOfertasUI(true);
    }

    // ------------------------------------- VENDA DO DIA ANTERIOR (arquivo de venda do dia)
    // O "VendaAtual" é o ACUMULADO do mês (uma linha por produto; DT.ULT.EV. é só a data da
    // última venda), então o dia anterior não pode ser separado dele. Por isso esta coluna lê
    // um arquivo no mesmo layout, exportado só com o período de ontem (ex.: VendaDia.xls),
    // usando EMB1 (caixas) e VLR.TOTAL (valor).

    // Retorna AAAAMMDD (número) ou null. Aceita dd/mm/aaaa, aaaa-mm-dd, Date e serial do Excel.
    function parseDateKey(v) {
        if (v === null || v === undefined || v === '') return null;
        let y, m, d;
        if (v instanceof Date && !isNaN(v)) {
            y = v.getFullYear(); m = v.getMonth() + 1; d = v.getDate();
        } else {
            const s = String(v).trim();
            let mt;
            if ((typeof v === 'number' || /^\d{5}$/.test(s)) && Number(s) > 20000 && Number(s) < 80000) {
                const dt = new Date(Math.round((Number(s) - 25569) * 86400000));
                y = dt.getUTCFullYear(); m = dt.getUTCMonth() + 1; d = dt.getUTCDate();
            } else if ((mt = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/))) {
                d = +mt[1]; m = +mt[2]; y = +mt[3];
                if (y < 100) y += 2000;
            } else if ((mt = s.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/))) {
                y = +mt[1]; m = +mt[2]; d = +mt[3];
            } else {
                return null;
            }
        }
        if (!(y >= 2000 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
        return y * 10000 + m * 100 + d;
    }

    function pickKey(row, names) {
        for (const n of names) if (row[n] !== undefined) return n;
        return null;
    }

    function computeVendaDiaAnterior(rows, fileName, origin) {
        const res = { map: new Map(), status: 'sem_arquivo', dateLabel: '', dateOk: true, fileName: fileName || '', origin: origin || '' };
        ofertasState.vendaDia = res;
        if (!rows || !rows.length) return;

        const first = rows[0];
        const kCx = pickKey(first, ['EMB1', 'EMB 1', 'CAIXAS', 'QTD.CX']);
        const kUn = pickKey(first, ['EMB9', 'EMB 9', 'UNIDADES']);
        const kDt = pickKey(first, ['DT.ULT.EV.', 'DT.ULT.EV', 'DT.ULT.EVENTO']);
        if (!kCx) { res.status = 'sem_colunas'; return; }

        // O relatório repete alguns produtos (só muda "SETOR BALANCO"): conta uma vez só
        const seen = new Set();
        let maxDate = 0;

        rows.forEach(r => {
            const rawCode = r['MERCADC'] || r['MERCADORIA'] || r['MERC'] || r['Código'] || r['CODIGO'] || r['PRODUTO'] || '';
            if (!rawCode) return;
            const sig = Object.keys(r).filter(k => k !== 'SETOR BALANCO').map(k => r[k]).join('|');
            if (seen.has(sig)) return;
            seen.add(sig);

            const id = sanitizeProductCode(rawCode);
            const acc = res.map.get(id) || { cx: 0, un: 0, valor: 0 };
            acc.cx += parseBRNumber(r[kCx]);
            acc.un += kUn ? parseBRNumber(r[kUn]) : 0;
            acc.valor += getRowSalesValue(r);
            res.map.set(id, acc);

            if (kDt) {
                const dk = parseDateKey(r[kDt]);
                if (dk && dk > maxDate) maxDate = dk;
            }
        });

        if (maxDate) {
            const dd = String(maxDate % 100).padStart(2, '0');
            const mm = String(Math.floor(maxDate / 100) % 100).padStart(2, '0');
            res.dateLabel = `${dd}/${mm}`;
            const now = new Date();
            const yest = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
            res.dateOk = maxDate === yest.getFullYear() * 10000 + (yest.getMonth() + 1) * 100 + yest.getDate();
        }
        res.status = 'ok';
    }
    window.computeVendaDiaAnterior = computeVendaDiaAnterior;

    function vendaDiaMensagem() {
        const vd = ofertasState.vendaDia;
        if (vd.status === 'ok') {
            return `Venda Dia Ant.: ${vd.dateLabel || 'arquivo do dia'}${vd.dateLabel && !vd.dateOk ? ' ⚠ data diferente de ontem' : ''}`;
        }
        const motivo = {
            'sem_arquivo': 'arquivo VendaDia.xls não encontrado na pasta (rode o Baixar_051.bat e selecione a pasta novamente)',
            'sem_colunas': 'o arquivo VendaDia não tem a coluna EMB1'
        }[vd.status] || 'sem dados';
        return `Venda Dia Ant. indisponível: ${motivo}`;
    }

    // ------------------------------------------------------- cruzamento / filtros
    function buildRows() {
        const base = getBaseMap();
        ofertasState.rows = ofertasState.offers.map(o => {
            const item = base.get(o.id) || null;
            let ref = null, refTipo = null, diff = null, divergente = false, semEstoque = false, cmp = null, isKg = false, rentOferta = null;
            if (item) {
                // Item "de KG" = vendido em KG (unidade de venda KG, ex.: "KG 1 X 1000 X 1KG").
                // Embalagens como "FDO 1 X 6 5KG" só têm peso no nome: são comparadas pelo Preço Und.
                isKg = /^\s*KGS?\b/i.test(String(item.embalagem || ''));
                refTipo = isKg ? 'CX' : 'UN';
                ref = isKg ? item.precoVenda : item.precoUnidade;
                rentOferta = calcRentabilidadeNegociada(isKg ? item.custoMedio : item.custoUnidade, ref, o.preco, item.rentabilidade);
                diff = o.preco - ref;
                const refC = Math.round(ref * 100), ofC = Math.round(o.preco * 100);
                divergente = refC !== ofC;
                cmp = refC > ofC ? 'maior' : (refC < ofC ? 'menor' : 'igual');   // preço ATUAL em relação à oferta
                semEstoque = !(item.estoqEmb1 > 0 || item.estoqEmb9 > 0);
            }
            const vd = ofertasState.vendaDia;
            const vendaDia = (item && vd.status === 'ok') ? (vd.map.get(o.id) || { cx: 0, un: 0, valor: 0 }) : null;
            return { oferta: o, item: item, ref: ref, refTipo: refTipo, diff: diff, vendaDia: vendaDia,
                     divergente: divergente, semEstoque: semEstoque, naoEncontrado: !item,
                     cmp: cmp, isKg: isKg, rentOferta: rentOferta,
                     bloqueado: !!item && String(item.prFixo || '').trim().toUpperCase() === 'S' };
        });
    }

    function refreshAcaoOptions() {
        const sel = $('filterOfertasAcao');
        const acoes = listaAcoes().sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }));
        if (ofertasState.filterAcao && !acoes.includes(ofertasState.filterAcao)) ofertasState.filterAcao = '';
        sel.innerHTML = '<option value="">Ação (Todas)</option>' +
            acoes.map(a => `<option value="${esc(a)}">${esc(a)}</option>`).join('');
        sel.value = ofertasState.filterAcao;
    }

    function refreshCompradorOptions() {
        const sel = $('filterOfertasComprador');
        const compradores = Array.from(new Set(
            ofertasState.rows.filter(r => r.item).map(r => r.item.comprador)
        )).sort((a, b) => String(a).localeCompare(String(b), 'pt-BR', { numeric: true }));

        if (ofertasState.filterComprador && !compradores.includes(ofertasState.filterComprador)) {
            ofertasState.filterComprador = '';
        }
        sel.innerHTML = '<option value="">Comprador (Todos)</option>' +
            compradores.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
        sel.value = ofertasState.filterComprador;
    }

    function sortValue(row, key) {
        if (key === 'precoOferta') return row.oferta.preco;
        if (key === 'acao') return row.oferta.acao;
        if (key === 'rentOferta') return row.rentOferta;
        if (key === 'vendaOntem') return row.vendaDia ? row.vendaDia.cx : null;
        if (!row.item) return null;
        if (key === 'dtUltEnt') {
            const m = String(row.item.dtUltEnt || '').match(/(\d{2})\/(\d{2})\/(\d{4})/);
            return m ? `${m[3]}${m[2]}${m[1]}` : '';
        }
        const v = row.item[key];
        return v === undefined ? null : v;
    }

    function getFilteredSortedRows() {
        const tipo = ofertasState.filterTipo;
        const comp = ofertasState.filterComprador;
        const terms = normTxt(ofertasState.search).split(/\s+/).filter(Boolean);

        let rows = ofertasState.rows.filter(r => {
            if (ofertasState.filterAcao && r.oferta.acao !== ofertasState.filterAcao) return false;
            if (terms.length) {
                const hay = r.item
                    ? normTxt(`${r.item.descricao} ${r.item.codigoCompleto} ${r.item.id} ${r.oferta.acao}`)
                    : normTxt(`${r.oferta.codigoDigitado} ${r.oferta.id} ${r.oferta.acao}`);
                if (!terms.every(t => hay.includes(t))) return false;
            }
            if (ofertasState.onlyStock && (r.naoEncontrado || r.semEstoque)) return false;
            if (tipo === 'sem_estoque' && !r.semEstoque) return false;
            if (ofertasState.onlyBloq && !r.bloqueado) return false;
            if (tipo === 'divergente' && !r.divergente) return false;
            if (tipo === 'atual_maior' && r.cmp !== 'maior') return false;
            if (tipo === 'atual_menor' && r.cmp !== 'menor') return false;
            if (tipo === 'nao_encontrado' && !r.naoEncontrado) return false;
            if (comp && (!r.item || r.item.comprador !== comp)) return false;
            return true;
        });

        const { key, direction } = ofertasState.sort;
        if (key) {
            rows = rows.slice().sort((a, b) => {
                const va = sortValue(a, key), vb = sortValue(b, key);
                if (va === null && vb === null) return 0;
                if (va === null) return 1;
                if (vb === null) return -1;
                const cmp = (typeof va === 'number' && typeof vb === 'number')
                    ? va - vb
                    : String(va).localeCompare(String(vb), 'pt-BR', { numeric: true });
                return direction === 'asc' ? cmp : -cmp;
            });
        }
        return rows;
    }

    // ------------------------------------------------------------------ render
    const COLS_APOS_OFERTA = ['col-idade', 'col-dias', 'col-autonomia', 'col-rentabilidade', 'col-acao', 'col-fornecedor',
        'col-pedidos', 'col-sta', 'col-comprador', 'col-venda30Dias', 'col-grupo', 'col-classe', 'col-digito',
        'col-qtdIdeal', 'col-dtUltEnt', 'col-qtdUltEnt', 'col-bloq1', 'col-bloq9',
        'col-pedFornec', 'col-pedFilial', 'col-pedFat'];

    function buildOfertaCell(r) {
        if (r.naoEncontrado) {
            return `<td class="col-precoOferta"><span class="badge badge-warning">${fmtTabela(r.oferta.preco)}</span>
                <span class="sub-text">Sem comparação</span></td>`;
        }
        const tag = r.refTipo === 'CX' ? 'Preço Cx.' : 'Preço Und.';
        if (!r.divergente) {
            return `<td class="col-precoOferta"><span class="badge badge-success">${fmtTabela(r.oferta.preco)}</span>
                <span class="sub-text">Igual ao ${tag}</span></td>`;
        }
        const sign = r.diff > 0 ? '▲ +' : '▼ -';
        return `<td class="col-precoOferta"><span class="badge badge-danger">${fmtTabela(r.oferta.preco)}</span>
            <span class="sub-text">${sign}${fmtTabela(Math.abs(r.diff))} vs ${tag}</span></td>`;
    }

    function buildRentOfertaCell(r) {
        if (r.naoEncontrado || r.rentOferta === null) return '<td class="col-rentOferta col-rentabilidade">-</td>';
        const v = r.rentOferta;
        const cls = v < 0 ? 'badge-danger' : (v <= 4.5 ? 'badge-warning' : 'badge-success');
        const d = v - r.item.rentabilidade;
        return `<td class="col-rentOferta col-rentabilidade"><span class="badge ${cls}">${v.toFixed(2)}%</span>
            <span class="sub-text">${d >= 0 ? '▲ +' : '▼ -'}${Math.abs(d).toFixed(2)} pp vs atual</span></td>`;
    }

    function buildPrFixoCell(r) {
        if (!r.item) return '<td class="col-precoFixo">-</td>';
        const v = String(r.item.prFixo || '').trim().toUpperCase();
        if (v === 'S') return '<td class="col-precoFixo"><span class="badge badge-warning">S</span></td>';
        return `<td class="col-precoFixo">${esc(v || '-')}</td>`;
    }

    function buildVendaCell(r) {
        if (r.naoEncontrado || !r.vendaDia) return '<td class="col-vendaOntem">-</td>';
        const cx = r.vendaDia.cx, v = r.vendaDia.valor;
        return `<td class="col-vendaOntem" title="${r.vendaDia.un.toLocaleString('pt-BR')} UN avulsas">
            <strong>${cx.toLocaleString('pt-BR')} CX</strong>
            <span class="sub-text">${v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span></td>`;
    }

    function buildRowHtml(r) {
        const item = r.item;
        const isSel = ofertasState.selected.has(r.oferta.key);
        const chkTd = `<td class="col-select"><input type="checkbox" class="row-select-chk" data-id="${esc(r.oferta.key)}" ${isSel ? 'checked' : ''} title="Selecionar para o PDF de Itens Selecionados"></td>`;

        if (!item) {
            return `<tr class="ofertas-row-notfound ${isSel ? 'row-selected' : ''}">
                ${chkTd}
                <td><strong>Código não encontrado na base</strong><span class="sub-text">Cód: ${esc(r.oferta.codigoDigitado)}</span></td>
                <td class="col-embalagem">-</td>
                <td class="col-estoque">-</td>
                <td class="col-valorEstoque">-</td>
                <td class="col-precoCx">-</td>
                <td class="col-precoUnd">-</td>
                ${buildOfertaCell(r)}
                ${buildRentOfertaCell(r)}
                ${buildPrFixoCell(r)}
                ${buildVendaCell(r)}
                ${COLS_APOS_OFERTA.map(c => `<td class="${c}">${c === 'col-acao' ? esc(r.oferta.acao) : '-'}</td>`).join('')}
            </tr>`;
        }

        let txtAutonomia = 'S/ Venda';
        if (item.venda30Dias > 0) txtAutonomia = `${Math.round(item.autonomiaDias)}d`;

        let rentClass = 'badge-success';
        if (item.rentabilidade < 0) rentClass = 'badge-danger';
        else if (item.rentabilidade <= 4.5) rentClass = 'badge-warning';

        const isAtivo = item.sta === 'Ativo' || item.sta === ' ' || item.sta === 'N/A';
        const staBadgeClass = isAtivo ? 'badge-sta' : 'badge-inativo';

        let riskBadgeClass = 'badge-normal';
        if (item.diasSemVenda > 6) riskBadgeClass = 'badge-critical';
        else if (item.diasSemVenda > 2) riskBadgeClass = 'badge-warning';

        const idadeInt = Math.round(item.idade);
        const idadeBadgeClass = idadeInt > 80 ? 'badge badge-idade-critical' : '';

        // Preço atual usado na comparação: laranja = maior que a oferta | verde = menor | azul = igual
        const refCls = ' ofertas-ref-price ofertas-ref-' + r.cmp;
        const refCx = r.refTipo === 'CX' ? refCls : '';
        const refUn = r.refTipo === 'UN' ? refCls : '';

        return `
        <tr class="${r.semEstoque ? 'ofertas-row-noStock' : ''} ${isSel ? 'row-selected' : ''}">
            ${chkTd}
            <td>
                <strong>${esc(item.descricao)}</strong>
                <span class="sub-text">Cód: ${esc(item.codigoCompleto)}</span>
            </td>
            <td class="col-embalagem">${esc(item.embalagem)}</td>
            <td class="col-estoque">
                <strong>${item.estoqEmb1.toLocaleString('pt-BR')} CX</strong>
                <span class="sub-text">${item.estoqEmb9.toLocaleString('pt-BR')} UN</span>
            </td>
            <td class="col-valorEstoque">
                <strong>${item.valorEstoqueTotal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</strong>
            </td>
            <td class="col-precoCx${refCx}">${fmtTabela(item.precoVenda)}</td>
            <td class="col-precoUnd${refUn}">${fmtTabela(item.precoUnidade)}</td>
            ${buildOfertaCell(r)}
            ${buildRentOfertaCell(r)}
            ${buildPrFixoCell(r)}
            ${buildVendaCell(r)}
            <td class="col-idade"><span class="${idadeBadgeClass}">${idadeInt} d</span></td>
            <td class="col-dias"><span class="badge ${riskBadgeClass}">${item.diasSemVenda} d</span></td>
            <td class="col-autonomia">${txtAutonomia}</td>
            <td class="col-rentabilidade"><span class="badge ${rentClass}">${item.rentabilidade.toFixed(2)}%</span></td>
            <td class="col-acao"><span class="badge badge-acao">${esc(r.oferta.acao)}</span></td>
            <td class="col-fornecedor"><span class="badge badge-fornecedor">${esc(item.fornecedorFormatted)}</span></td>
            <td class="col-pedidos">${item.pedidosPendentes.toLocaleString('pt-BR')}</td>
            <td class="col-sta"><span class="badge ${staBadgeClass}">${esc(item.sta)}</span></td>
            <td class="col-comprador">${esc(item.comprador)}</td>
            <td class="col-venda30Dias">${item.venda30Dias.toLocaleString('pt-BR')}</td>
            <td class="col-grupo">${esc(item.grupo)} / ${esc(item.subgrupo)}</td>
            <td class="col-classe">${esc(item.classe)}</td>
            <td class="col-digito">${esc(item.digito)}</td>
            <td class="col-qtdIdeal">${item.qtdIdeal.toLocaleString('pt-BR')}</td>
            <td class="col-dtUltEnt">${esc(item.dtUltEnt)}</td>
            <td class="col-qtdUltEnt">${item.qtdUltEnt.toLocaleString('pt-BR')}</td>
            <td class="col-bloq1">${esc(item.bloq1)}</td>
            <td class="col-bloq9">${esc(item.bloq9)}</td>
            <td class="col-pedFornec">${item.pedFornec.toLocaleString('pt-BR')}</td>
            <td class="col-pedFilial">${item.pedFilial.toLocaleString('pt-BR')}</td>
            <td class="col-pedFat">${item.pedFat.toLocaleString('pt-BR')}</td>
        </tr>`;
    }

    // ---------------------------------------------------------------- seleção
    function getSelectedRows() {
        if (!ofertasState.selected.size) return [];
        const shown = getFilteredSortedRows().filter(r => ofertasState.selected.has(r.oferta.key));
        const seen = new Set(shown);
        const hidden = ofertasState.rows.filter(r => ofertasState.selected.has(r.oferta.key) && !seen.has(r));
        return shown.concat(hidden);
    }

    function updateSelectionUI(rowsShown) {
        const total = ofertasState.selected.size;
        const rows = rowsShown || getFilteredSortedRows();
        const n = rows.filter(r => ofertasState.selected.has(r.oferta.key)).length;   // marcados entre os exibidos

        const btn = $('btnOfertasPdfSelecionados');
        if (btn) btn.textContent = `✅ Itens Selecionados (${total})`;

        const chkAll = $('chkOfertasSelectAll');
        if (chkAll) {
            chkAll.checked = rows.length > 0 && n === rows.length;
            chkAll.indeterminate = n > 0 && n < rows.length;
        }

        // Botão Excluir Selecionados
        const del = $('btnOfertasDelSel');
        if (del) {
            del.textContent = `🗑️ Excluir Selecionados (${total})`;
            del.disabled = total === 0;
        }

        // Cartão de contagem em tempo real
        const kpi = $('kpiOfertasSelecionados');
        if (kpi) {
            kpi.textContent = total.toLocaleString('pt-BR');
            const sub = $('kpiOfertasSelecionadosSub');
            if (sub) {
                sub.textContent = total === 0 ? 'Marque as caixinhas da tabela'
                    : (n === total ? `${n.toLocaleString('pt-BR')} entre os exibidos`
                        : `${n.toLocaleString('pt-BR')} exibidos · ${(total - n).toLocaleString('pt-BR')} ${total - n === 1 ? 'oculto' : 'ocultos'} por filtro`);
            }
            const card = $('cardOfertasSel');
            if (card) card.classList.toggle('selection-active', total > 0);
        }
    }

    // Exclui da lista de ofertas os itens marcados nas caixinhas
    function deleteSelected() {
        const total = ofertasState.selected.size;
        if (!total) return;
        const exibidos = getFilteredSortedRows().filter(r => ofertasState.selected.has(r.oferta.key)).length;
        let msg = `Excluir ${total} item(ns) selecionado(s) da lista de ofertas?`;
        const ocultos = total - exibidos;
        if (ocultos > 0) msg += `\n\nAtenção: ${ocultos} ${ocultos === 1 ? 'deles está oculto' : 'deles estão ocultos'} pelos filtros atuais.`;
        if (!confirm(msg)) return;

        ofertasState.offers = ofertasState.offers.filter(o => !ofertasState.selected.has(o.key));
        ofertasState.selected.clear();
        renderOfertasUI(true);
    }

    function updateKpis(rows) {
        const set = (id, v) => { const el = $(id); if (el) el.textContent = v.toLocaleString('pt-BR'); };
        set('kpiOfertasTotal', rows.length);
        set('kpiOfertasEncontrados', rows.filter(r => r.item).length);
        set('kpiOfertasNaoEnc', rows.filter(r => r.naoEncontrado).length);
        set('kpiOfertasSemEstoque', rows.filter(r => r.semEstoque).length);
        set('kpiOfertasDivergentes', rows.filter(r => r.divergente).length);
    }

    function updateVendaStatus() {
        const el = $('ofertasVendaStatus');
        if (!el) return;
        const vd = ofertasState.vendaDia;
        el.title = vendaDiaMensagem();
        if (vd.status === 'ok') {
            el.className = 'ofertas-venda-status ok';
            el.textContent = `✔ ${vd.fileName || 'Venda do dia'}${vd.dateLabel ? ' · ' + vd.dateLabel : ''} · ${vd.map.size.toLocaleString('pt-BR')} produtos`;
        } else {
            el.className = 'ofertas-venda-status warn';
            el.textContent = vd.status === 'sem_colunas' ? '⚠ VendaDia sem coluna EMB1' : '⚠ VendaDia.xls não encontrado na pasta';
        }
    }

    function updateSortIcons() {
        document.querySelectorAll('#tableOfertas th[data-sort-key]').forEach(th => {
            th.classList.remove('sort-asc', 'sort-desc');
            if (th.getAttribute('data-sort-key') === ofertasState.sort.key) {
                th.classList.add(ofertasState.sort.direction === 'asc' ? 'sort-asc' : 'sort-desc');
            }
        });
    }

    function renderOfertasUI(force) {
        salvarOfertas();
        if (!force && state.activeTab !== 'tab-ofertas') return;
        if (!$('ofertasTableBody')) return;

        buildRows();
        refreshCompradorOptions();
        refreshAcaoOptions();

        const hasOffers = ofertasState.offers.length > 0;
        const hasBase = (state.rawProcessedData || []).length > 0;
        const rows = getFilteredSortedRows();

        updateKpis(rows);
        updateSortIcons();
        updateSelectionUI(rows);

        const thVenda = document.querySelector('#tableOfertas th.col-vendaOntem');
        if (thVenda) {
            thVenda.textContent = (ofertasState.vendaDia.status === 'ok' && ofertasState.vendaDia.dateLabel)
                ? `Venda Dia Ant. (${ofertasState.vendaDia.dateLabel})` : 'Venda Dia Ant.';
            thVenda.title = vendaDiaMensagem();
        }
        updateVendaStatus();

        $('btnOfertasClearData').disabled = !hasOffers;
        $('btnOfertasPdf').disabled = !hasOffers || !hasBase;

        const tbody = $('ofertasTableBody');
        if (!hasOffers) {
            tbody.innerHTML = `<tr><td colspan="32" class="empty-state">Clique em “📋 Colar Dados” para importar a lista de códigos e preços da oferta.</td></tr>`;
            $('ofertasPageInfo').textContent = 'Nenhuma oferta importada';
            return;
        }
        if (!hasBase) {
            tbody.innerHTML = `<tr><td colspan="32" class="empty-state">${ofertasState.offers.length} itens de oferta importados. Selecione a pasta com os arquivos de dados para cruzar com a base e conferir os preços.</td></tr>`;
            $('ofertasPageInfo').textContent = `${ofertasState.offers.length} itens aguardando a base de dados`;
            return;
        }
        if (!rows.length) {
            tbody.innerHTML = `<tr><td colspan="32" class="empty-state">Nenhum item da oferta encontrado para os filtros selecionados.</td></tr>`;
        } else {
            tbody.innerHTML = rows.map(buildRowHtml).join('');
        }
        $('ofertasPageInfo').textContent = `Exibindo ${rows.length.toLocaleString('pt-BR')} de ${ofertasState.rows.length.toLocaleString('pt-BR')} itens da oferta  ·  ${vendaDiaMensagem()}`;

        // Mantém as mesmas colunas visíveis/ocultas escolhidas na Dashboard
        if (typeof syncColumnVisibility === 'function') syncColumnVisibility();
    }
    window.renderOfertasUI = renderOfertasUI;

    // ------------------------------------------- integração com a Dashboard (Preço Negociado)
    const ACAO_NEGOCIADO = 'Preço Negociado';

    // Base de comparação do item: KG vendido em KG -> Preço Cx. ; demais -> Preço Und.
    window.ofertasBaseDoItem = function (item) {
        const isKg = /^\s*KGS?\b/i.test(String(item.embalagem || ''));
        return isKg
            ? { tipo: 'CX', preco: item.precoVenda, custo: item.custoMedio }
            : { tipo: 'UN', preco: item.precoUnidade, custo: item.custoUnidade };
    };

    // Oferta já existente do produto na ação "Preço Negociado" (ou null)
    window.ofertasGetOferta = function (itemId) {
        const key = normTxt(ACAO_NEGOCIADO) + '\u0001' + itemId;
        return ofertasState.offers.find(o => o.key === key) || null;
    };

    // Adiciona (ou atualiza) o produto na ação "Preço Negociado" com o preço informado
    window.ofertasAdicionarNegociado = function (item, preco) {
        const acaoKey = normTxt(ACAO_NEGOCIADO);
        const existente = ofertasState.offers.find(o => normTxt(o.acao) === acaoKey);
        const acao = existente ? existente.acao : ACAO_NEGOCIADO;
        const key = acaoKey + '\u0001' + item.id;
        const obj = { key: key, id: item.id, codigoDigitado: item.codigoCompleto, preco: preco, acao: acao };
        const idx = ofertasState.offers.findIndex(o => o.key === key);
        if (idx >= 0) ofertasState.offers[idx] = obj;
        else ofertasState.offers.push(obj);
        renderOfertasUI(true);
        return { atualizado: idx >= 0 };
    };

    // --------------------------------------------------------------------- PDF
    const TIPO_LABEL = {
        '': 'Todos os itens',
        'sem_estoque': 'Itens sem estoque',
        'divergente': 'Preços divergentes',
        'atual_maior': 'Preço atual maior que a oferta',
        'atual_menor': 'Preço atual menor que a oferta',
        'nao_encontrado': 'Códigos não encontrados'
    };

    // Modos: 'filtrado' (Conferência de Preços), 'selecionados' (só os marcados, com preços)
    //        e 'produtos' (Conferência de Produtos: as mesmas informações, SEM as colunas de preço)
    function exportOfertasPDF(mode) {
        const isSel = mode === 'selecionados';
        const semPrecos = mode === 'produtos';
        const rows = isSel ? getSelectedRows() : getFilteredSortedRows();
        if (!rows.length) {
            alert(isSel
                ? 'Nenhum item selecionado. Marque as caixinhas na frente dos produtos para gerar este PDF.'
                : 'Não há itens da oferta para gerar o PDF (verifique os filtros).');
            return;
        }
        if (!window.jspdf) {
            alert('Biblioteca de PDF não carregada.');
            return;
        }

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

        const estoqueTxt = (it) => {
            let t = `${it.estoqEmb1.toLocaleString('pt-BR')}CX`;
            if (it.estoqEmb9 > 0) t += ` + ${it.estoqEmb9.toLocaleString('pt-BR')}UN`;
            return t;
        };

        // Colunas (cada uma com cabeçalho, largura, alinhamento e como obter o valor da linha).
        // A soma das larguras é sempre 198 mm (A4 retrato com margens de 6 mm).
        const cols = [
            { key: 'produto', head: 'Produto + Código', w: semPrecos ? 58 : 52,
              get: r => r.item ? `${r.item.descricao}\n(Cód: ${r.item.codigoCompleto})` : `Código não encontrado na base\n(Cód: ${r.oferta.codigoDigitado})` },
            { key: 'emb', head: 'Emb.', w: semPrecos ? 28 : 13, align: 'center', get: r => r.item ? (r.item.embalagem || '-') : '-' },
            { key: 'estoque', head: 'Estoque', w: semPrecos ? 26 : 24, align: 'right', get: r => r.item ? estoqueTxt(r.item) : '-' },
            { key: 'dtent', head: 'Dt Entrada', w: semPrecos ? 20 : 16, align: 'center', get: r => r.item ? (r.item.dtUltEnt || '-') : '-' },
            { key: 'qtdent', head: 'Qtd Entrada', w: semPrecos ? 20 : 15, align: 'right', get: r => r.item ? r.item.qtdUltEnt.toLocaleString('pt-BR') : '-' },
            { key: 'dias', head: 'Dias s/ Vendas', w: semPrecos ? 18 : 14, align: 'center', get: r => r.item ? `${r.item.diasSemVenda} dias` : '-' },
            { key: 'acao', head: 'Ação', w: semPrecos ? 28 : 24, align: 'left', get: r => r.oferta.acao }
        ];
        if (!semPrecos) {
            cols.push({ key: 'atual', head: 'Preço Atual', w: 20, align: 'right', get: r => r.item ? `${fmtPdf(r.ref)}\n(${r.refTipo})` : '-' });
            cols.push({ key: 'oferta', head: 'Preço Oferta', w: 20, align: 'right', bold: true, get: r => fmtPdf(r.oferta.preco) });
        }

        const headers = [cols.map(c => c.head)];
        const bodyData = rows.map(r => cols.map(c => c.get(r)));
        const columnStyles = {};
        cols.forEach((c, i) => {
            columnStyles[i] = { cellWidth: c.w };
            if (c.align) columnStyles[i].halign = c.align;
            if (c.bold) columnStyles[i].fontStyle = 'bold';
        });
        const idxOferta = cols.findIndex(c => c.key === 'oferta');

        const now = new Date();
        const dateFormatted = now.toLocaleDateString('pt-BR');
        const generationStamp = `Gerado em: ${dateFormatted} às ${now.toLocaleTimeString('pt-BR')}`;

        let filtroTxt;
        if (isSel) {
            filtroTxt = `Itens selecionados: ${rows.length}`;
        } else {
            filtroTxt = `Filtro: ${TIPO_LABEL[ofertasState.filterTipo] || 'Todos os itens'}`;
            if (ofertasState.filterComprador) filtroTxt += `  |  Comprador: ${ofertasState.filterComprador}`;
            if (ofertasState.filterAcao) filtroTxt += `  |  Ação: ${ofertasState.filterAcao}`;
            if (ofertasState.onlyStock) filtroTxt += '  |  Somente com Estoque';
            if (ofertasState.onlyBloq) filtroTxt += '  |  Produtos Bloqueados (Preço Fixo = S)';
            if (ofertasState.search.trim()) filtroTxt += `  |  Busca: ${ofertasState.search.trim()}`;
        }

        const titulo = semPrecos ? 'CONFERÊNCIA DE PRODUTOS (OFERTAS)'
            : (isSel ? 'RELATÓRIO DE OFERTAS - ITENS SELECIONADOS' : 'RELATÓRIO DE OFERTAS');

        doc.autoTable({
            head: headers,
            body: bodyData,
            startY: 18,
            margin: { top: 18, bottom: 20, left: 6, right: 6 },
            theme: 'grid',
            styles: { fontSize: 6, cellPadding: 0.8, valign: 'middle', overflow: 'linebreak', lineColor: [203, 213, 225], lineWidth: 0.15 },
            headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255], fontStyle: 'bold', halign: 'center', fontSize: 6.5, cellPadding: 1 },
            columnStyles: columnStyles,
            // Preço de oferta: verde = igual ao praticado | vermelho = divergente | laranja = sem comparação
            didParseCell: (data) => {
                if (data.section !== 'body') return;
                const r = rows[data.row.index];
                if (!r) return;
                if (idxOferta >= 0 && data.column.index === idxOferta) {
                    if (r.naoEncontrado) data.cell.styles.textColor = [180, 83, 9];
                    else if (r.divergente) data.cell.styles.textColor = [185, 28, 28];
                    else data.cell.styles.textColor = [21, 128, 61];
                }
                if (data.column.index === 0 && r.naoEncontrado) data.cell.styles.textColor = [180, 83, 9];
            },
            didDrawPage: () => {
                const pageHeight = doc.internal.pageSize.height;
                const pageWidth = doc.internal.pageSize.width;

                doc.setFontSize(9);
                doc.setFont('helvetica', 'bold');
                doc.setTextColor(11, 17, 32);
                doc.text(`Management Overview - ${titulo}`, 6, 9);

                doc.setFontSize(6.5);
                doc.setFont('helvetica', 'normal');
                doc.setTextColor(100, 116, 139);
                doc.text(`Total de itens: ${rows.length.toLocaleString('pt-BR')}   |   ${filtroTxt}`, 6, 13.5);

                doc.setLineWidth(0.2);
                doc.setDrawColor(203, 213, 225);
                doc.line(6, 15, pageWidth - 6, 15);

                doc.setFontSize(6.5);
                doc.setTextColor(71, 85, 105);
                doc.text('Assinatura: ___________________________', 6, pageHeight - 11);
                doc.text('Data: ____/____/________', 90, pageHeight - 11);

                doc.setDrawColor(226, 232, 240);
                doc.line(6, pageHeight - 8, pageWidth - 6, pageHeight - 8);

                doc.setFontSize(6);
                doc.text(generationStamp, 6, pageHeight - 4);
            }
        });

        const totalPages = doc.internal.getNumberOfPages();
        for (let i = 1; i <= totalPages; i++) {
            doc.setPage(i);
            doc.setFontSize(6);
            doc.setTextColor(71, 85, 105);
            doc.text(`Página ${i} de ${totalPages}`, doc.internal.pageSize.width - 25, doc.internal.pageSize.height - 4);
        }

        const sufixo = semPrecos ? 'Conferencia_Produtos' : `Ofertas${isSel ? '_Selecionados' : ''}`;
        doc.save(`Relatorio_${sufixo}_${dateFormatted.replace(/\//g, '-')}.pdf`);
    }

    // ------------------------------------------------------- PDF PARA CLIENTES
    // Formato de divulgação: cabeçalho "OFERTAS VÁLIDAS ATÉ dd/mm/aaaa", sem códigos,
    // colunas Produto | Embalagem | Preço (itens de KG levam "kg" no preço),
    // retrato A4 ocupando a folha de lado a lado (margens mínimas).
    function fmtDataBR(iso) {
        const p = String(iso).split('-');
        return `${p[2]}/${p[1]}/${p[0]}`;
    }

    function isoHoje(offsetDias) {
        const d = new Date();
        const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + (offsetDias || 0));
        return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
    }

    function clienteRowsBase() {
        const selVisivel = !$('lblOfertasClienteSel').classList.contains('hidden');
        const onlySel = selVisivel && $('chkOfertasClienteSel').checked;
        return onlySel ? getSelectedRows() : getFilteredSortedRows();
    }

    function refreshClienteInfo() {
        const all = clienteRowsBase();
        const n = all.filter(r => r.item).length;
        const om = all.length - n;
        let txt = `<strong>${n}</strong> itens no PDF`;
        if (om) txt += ` · <span class="ofertas-warn">${om} não encontrados na base ficam de fora</span>`;
        if (!$('lblOfertasClienteSel').classList.contains('hidden') && !$('chkOfertasClienteSel').checked) txt += ' · respeita os filtros atuais';
        $('ofertasClienteInfo').innerHTML = txt;
    }

    function openClienteModal() {
        const nSel = ofertasState.selected.size;
        const lbl = $('lblOfertasClienteSel');
        if (nSel > 0) {
            lbl.classList.remove('hidden');
            $('txtOfertasClienteSel').textContent = `Somente os ${nSel} itens selecionados`;
            $('chkOfertasClienteSel').checked = true;
        } else {
            lbl.classList.add('hidden');
            $('chkOfertasClienteSel').checked = false;
        }
        $('ofertasDataIni').value = ofertasState.clienteDates.ini || isoHoje(0);
        $('ofertasDataFim').value = ofertasState.clienteDates.fim || isoHoje(6);
        refreshClienteInfo();
        $('modalOfertasCliente').classList.remove('hidden');
    }

    function closeClienteModal() {
        $('modalOfertasCliente').classList.add('hidden');
    }

    function gerarPdfClientes() {
        const ini = $('ofertasDataIni').value;
        const fim = $('ofertasDataFim').value;
        if (!ini || !fim) {
            alert('Informe a data de início e a data de fim da oferta.');
            return;
        }
        if (fim < ini) {
            alert('A data de fim não pode ser anterior à data de início.');
            return;
        }
        const rows = clienteRowsBase().filter(r => r.item);
        if (!rows.length) {
            alert('Não há itens da oferta para gerar o PDF (verifique os filtros ou a seleção).');
            return;
        }
        if (!window.jspdf) {
            alert('Biblioteca de PDF não carregada.');
            return;
        }
        ofertasState.clienteDates = { ini: ini, fim: fim };
        closeClienteModal();
        exportOfertasClientesPDF(rows, ini, fim);
    }

    function exportOfertasClientesPDF(rows, iniIso, fimIso) {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
        const pageW = doc.internal.pageSize.getWidth();
        const pageH = doc.internal.pageSize.getHeight();

        const M = 4;                                   // margem lateral mínima (mm)
        const ORANGE = [249, 99, 15];                  // laranja do logo
        const GREEN = [0, 160, 96];                    // verde do logo
        const DARK = [15, 23, 42];
        const MUTED = [100, 116, 139];
        const H1 = 31;                                 // cabeçalho completo (1ª página)
        const H2 = 13;                                 // cabeçalho compacto (demais páginas)
        const iniBR = fmtDataBR(iniIso), fimBR = fmtDataBR(fimIso);
        const tagText = `OFERTAS VÁLIDAS ATÉ ${fimBR}`;
        const stockNote = 'Ofertas válidas enquanto durarem os estoques.';
        // Tag laranja (pílula) centralizada
        const drawTag = (text, centerX, y, h, size) => {
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(size);
            const w = doc.getTextWidth(text) + h * 1.3;
            doc.setFillColor(ORANGE[0], ORANGE[1], ORANGE[2]);
            doc.roundedRect(centerX - w / 2, y, w, h, h / 2, h / 2, 'F');
            doc.setTextColor(255, 255, 255);
            doc.text(text, centerX, y + h / 2 + size * 0.127, { align: 'center' });
        };

        const drawBars = (g, o) => {
            doc.setFillColor(GREEN[0], GREEN[1], GREEN[2]);
            doc.rect(0, 0, pageW, g, 'F');
            doc.setFillColor(ORANGE[0], ORANGE[1], ORANGE[2]);
            doc.rect(0, g, pageW, o, 'F');
        };

        const headerFull = () => {
            drawBars(2, 0.7);
            drawTag(tagText, pageW / 2, 6, 9.5, 14.5);
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(9);
            doc.setTextColor(DARK[0], DARK[1], DARK[2]);
            doc.text(`Período: ${iniBR} a ${fimBR}`, pageW / 2, 20.4, { align: 'center' });
            doc.setFont('helvetica', 'italic');
            doc.setFontSize(8);
            doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
            doc.text(stockNote, pageW / 2, 24.8, { align: 'center' });
            doc.setDrawColor(226, 232, 240);
            doc.setLineWidth(0.2);
            doc.line(M, 27.8, pageW - M, 27.8);
        };

        const headerCompact = () => {
            drawBars(1.4, 0.5);
            drawTag(tagText, pageW / 2, 4.2, 6, 8.5);
        };

        const bodyData = rows.map(r => [
            r.item.descricao,
            r.item.embalagem || '',
            fmtPdf(r.oferta.preco) + (r.isKg ? ' kg' : '')
        ]);

        doc.autoTable({
            head: [['PRODUTO', 'EMBALAGEM', 'PREÇO']],
            body: bodyData,
            startY: H1,
            margin: { top: H2, bottom: 8, left: M, right: M },
            tableWidth: pageW - 2 * M,
            theme: 'plain',
            styles: { fontSize: 7.8, cellPadding: { top: 1.15, bottom: 1.15, left: 2, right: 2 }, valign: 'middle',
                      overflow: 'linebreak', lineWidth: 0, textColor: DARK },
            headStyles: { fillColor: GREEN, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7.2,
                          cellPadding: { top: 1.6, bottom: 1.6, left: 2, right: 2 } },
            alternateRowStyles: { fillColor: [244, 250, 246] },
            columnStyles: {
                0: { cellWidth: pageW - 2 * M - 82, fontStyle: 'bold' },
                1: { cellWidth: 38, halign: 'center', fontSize: 7.2, textColor: MUTED },
                2: { cellWidth: 44, halign: 'right', fontStyle: 'bold', fontSize: 9.5, textColor: [234, 88, 12] }
            },
            // Cabeçalho da tabela sempre branco sobre verde (os estilos de coluna não podem sobrescrever)
            didParseCell: (d) => {
                if (d.section !== 'head') return;
                d.cell.styles.textColor = [255, 255, 255];
                d.cell.styles.fontStyle = 'bold';
                d.cell.styles.fontSize = 7.2;
            },
            // Filete fino sob cada linha (visual mais limpo que grade completa)
            didDrawCell: (d) => {
                if (d.section !== 'body') return;
                doc.setDrawColor(226, 232, 240);
                doc.setLineWidth(0.1);
                doc.line(d.cell.x, d.cell.y + d.cell.height, d.cell.x + d.cell.width, d.cell.y + d.cell.height);
            },
            didDrawPage: (d) => {
                if (d.pageNumber === 1) headerFull(); else headerCompact();
            }
        });

        const totalPages = doc.internal.getNumberOfPages();
        for (let i = 1; i <= totalPages; i++) {
            doc.setPage(i);
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(6.5);
            doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
            doc.text(stockNote, M, pageH - 3);
            doc.text(`Página ${i} de ${totalPages}`, pageW - M, pageH - 3, { align: 'right' });
        }

        doc.save(`Ofertas_Clientes_ate_${fimBR.replace(/\//g, '-')}.pdf`);
    }

    // ------------------------------------------------------------------ eventos
    function clearFilters() {
        ofertasState.filterTipo = '';
        ofertasState.filterComprador = '';
        ofertasState.onlyStock = false;
        ofertasState.onlyBloq = false;
        ofertasState.filterAcao = '';
        ofertasState.search = '';
        $('searchOfertas').value = '';
        $('toggleOfertasOnlyStock').checked = false;
        $('toggleOfertasOnlyBloq').checked = false;
        $('filterOfertasTipo').value = '';
        ofertasState.sort = { key: null, direction: 'asc' };
        renderOfertasUI(true);
    }

    function clearData() {
        if (!ofertasState.offers.length) return;
        if (!confirm('Limpar todos os dados da oferta importada?')) return;
        ofertasState.offers = [];
        ofertasState.rows = [];
        ofertasState.filterTipo = '';
        ofertasState.filterComprador = '';
        ofertasState.onlyStock = false;
        ofertasState.onlyBloq = false;
        ofertasState.filterAcao = '';
        ofertasState.selected.clear();
        ofertasState.search = '';
        $('searchOfertas').value = '';
        $('toggleOfertasOnlyStock').checked = false;
        $('toggleOfertasOnlyBloq').checked = false;
        ofertasState.sort = { key: null, direction: 'asc' };
        $('filterOfertasTipo').value = '';
        renderOfertasUI(true);
    }

    function init() {
        restaurarOfertas();
        if (!$('tab-ofertas')) return;

        $('btnOfertasPaste').addEventListener('click', openPasteModal);
        $('btnCloseOfertasPaste').addEventListener('click', closePasteModal);
        $('btnOfertasPasteCancel').addEventListener('click', closePasteModal);
        $('btnOfertasPasteApply').addEventListener('click', applyPaste);
        $('ofertasPasteArea').addEventListener('input', onPasteChanged);
        $('selOfertasColCodigo').addEventListener('change', onMappingChanged);
        $('selOfertasColPreco').addEventListener('change', onMappingChanged);

        $('filterOfertasTipo').addEventListener('change', (e) => {
            ofertasState.filterTipo = e.target.value;
            renderOfertasUI(true);
        });
        $('filterOfertasAcao').addEventListener('change', (e) => {
            ofertasState.filterAcao = e.target.value;
            renderOfertasUI(true);
        });
        $('filterOfertasComprador').addEventListener('change', (e) => {
            ofertasState.filterComprador = e.target.value;
            renderOfertasUI(true);
        });

        let searchTimer = null;
        $('searchOfertas').addEventListener('input', (e) => {
            ofertasState.search = e.target.value;
            clearTimeout(searchTimer);
            searchTimer = setTimeout(() => renderOfertasUI(true), 150);
        });

        $('toggleOfertasOnlyStock').addEventListener('change', (e) => {
            ofertasState.onlyStock = e.target.checked;
            renderOfertasUI(true);
        });

        $('btnOfertasClearFilters').addEventListener('click', clearFilters);
        $('btnOfertasClearData').addEventListener('click', clearData);
        $('btnOfertasDelSel').addEventListener('click', deleteSelected);
        $('toggleOfertasOnlyBloq').addEventListener('change', (e) => {
            ofertasState.onlyBloq = e.target.checked;
            renderOfertasUI(true);
        });

        // Seleção de linhas (caixinhas)
        $('ofertasTableBody').addEventListener('change', (e) => {
            const chk = e.target.closest('.row-select-chk');
            if (!chk) return;
            const id = chk.getAttribute('data-id');
            if (chk.checked) ofertasState.selected.add(id);
            else ofertasState.selected.delete(id);
            const tr = chk.closest('tr');
            if (tr) tr.classList.toggle('row-selected', chk.checked);
            updateSelectionUI();
        });
        $('chkOfertasSelectAll').addEventListener('change', (e) => {
            const checked = e.target.checked;
            getFilteredSortedRows().forEach(r => {
                if (checked) ofertasState.selected.add(r.oferta.key);
                else ofertasState.selected.delete(r.oferta.key);
            });
            renderOfertasUI(true);
        });

        // Menu de PDF
        const ddPdf = $('dropdownOfertasPdf');
        $('btnOfertasPdf').addEventListener('click', (e) => {
            e.stopPropagation();
            ddPdf.classList.toggle('hidden');
        });
        document.addEventListener('click', (e) => {
            if (!ddPdf.classList.contains('hidden') && !e.target.closest('#ofertasPdfWrapper')) ddPdf.classList.add('hidden');
        });
        $('btnOfertasPdfConferencia').addEventListener('click', () => { ddPdf.classList.add('hidden'); exportOfertasPDF('filtrado'); });
        $('btnOfertasPdfSelecionados').addEventListener('click', () => { ddPdf.classList.add('hidden'); exportOfertasPDF('selecionados'); });
        $('btnOfertasPdfProdutos').addEventListener('click', () => { ddPdf.classList.add('hidden'); exportOfertasPDF('produtos'); });
        $('btnOfertasPdfClientes').addEventListener('click', () => { ddPdf.classList.add('hidden'); openClienteModal(); });
        $('btnOfertasClearSelection').addEventListener('click', () => {
            ddPdf.classList.add('hidden');
            ofertasState.selected.clear();
            renderOfertasUI(true);
        });

        // Modal do PDF para clientes
        $('btnCloseOfertasCliente').addEventListener('click', closeClienteModal);
        $('btnOfertasClienteCancel').addEventListener('click', closeClienteModal);
        $('btnOfertasClienteGerar').addEventListener('click', gerarPdfClientes);
        $('chkOfertasClienteSel').addEventListener('change', refreshClienteInfo);

        document.querySelectorAll('#tableOfertas th[data-sort-key]').forEach(th => {
            th.addEventListener('click', () => {
                const key = th.getAttribute('data-sort-key');
                if (ofertasState.sort.key === key) {
                    ofertasState.sort.direction = ofertasState.sort.direction === 'asc' ? 'desc' : 'asc';
                } else {
                    ofertasState.sort = { key: key, direction: 'asc' };
                }
                renderOfertasUI(true);
            });
        });

        const tabBtn = document.querySelector('.tab-btn[data-tab="tab-ofertas"]');
        if (tabBtn) tabBtn.addEventListener('click', () => renderOfertasUI(true));

        renderOfertasUI(true);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
