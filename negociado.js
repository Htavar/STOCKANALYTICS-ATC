// =============================================================================
// PREÇO NEGOCIADO (DASHBOARD -> ABA OFERTAS)
// -----------------------------------------------------------------------------
// Ao clicar em um produto da Dashboard abre uma janela pequena com produto, código,
// estoque, preço atual, custo médio e margem atual, e uma caixa para digitar o preço
// que se pensa em negociar. A nova rentabilidade é calculada em tempo real; ao dar
// ENTER o item vai direto para a aba Ofertas, na ação "Preço Negociado".
//
// Depende de script.js (state) e ofertas.js (calcRentabilidadeNegociada,
// ofertasBaseDoItem, ofertasAdicionarNegociado, ofertasGetOferta, ofertasParsePreco).
// =============================================================================
(function () {
    'use strict';

    const $ = (id) => document.getElementById(id);
    const neg = { item: null, base: null, precoN: null, rentN: null };
    let toastTimer = null;

    const fmt = (v) => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const pct = (v) => v.toFixed(2).replace('.', ',') + '%';
    const rentColor = (v) => v < 0 ? '#ef4444' : (v <= 4.5 ? '#f59e0b' : '#22c55e');

    function parsePreco(raw) {
        return typeof window.ofertasParsePreco === 'function' ? window.ofertasParsePreco(raw) : null;
    }

    function toast(msg) {
        let el = $('negToast');
        if (!el) {
            el = document.createElement('div');
            el.id = 'negToast';
            el.className = 'neg-toast';
            document.body.appendChild(el);
        }
        el.textContent = msg;
        el.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => el.classList.remove('show'), 4200);
    }

    // Recalcula a rentabilidade a cada tecla
    function atualizarResultado() {
        const out = $('negRentNova');
        const delta = $('negRentDelta');
        const precoN = parsePreco($('negPreco').value);
        neg.precoN = precoN;
        neg.rentN = null;
        $('negAviso').textContent = '';

        if (!precoN) {
            out.textContent = '-';
            out.style.color = '';
            delta.textContent = '';
            return;
        }

        const rent = window.calcRentabilidadeNegociada(neg.base.custo, neg.base.preco, precoN, neg.item.rentabilidade);
        if (rent === null) {
            out.textContent = 'Sem custo';
            out.style.color = '#f59e0b';
            delta.textContent = 'Sem custo médio ou preço atual: a rentabilidade não pode ser calculada.';
            return;
        }

        neg.rentN = rent;
        out.textContent = pct(rent);
        out.style.color = rentColor(rent);
        const d = rent - neg.item.rentabilidade;
        const varPreco = neg.base.preco > 0 ? (precoN / neg.base.preco - 1) * 100 : null;
        delta.textContent = `${d >= 0 ? '▲ +' : '▼ -'}${Math.abs(d).toFixed(2).replace('.', ',')} pp vs atual` +
            (varPreco !== null ? ` · preço ${varPreco >= 0 ? '+' : ''}${varPreco.toFixed(1).replace('.', ',')}%` : '');
    }

    function abrir(item) {
        const base = window.ofertasBaseDoItem(item);
        neg.item = item;
        neg.base = base;
        neg.precoN = null;
        neg.rentN = null;

        $('negDescricao').textContent = item.descricao;
        $('negCodigo').textContent = `Cód: ${item.codigoCompleto} · ${item.embalagem || '-'}`;
        $('negEstoque').textContent = `${item.estoqEmb1.toLocaleString('pt-BR')} CX | ${item.estoqEmb9.toLocaleString('pt-BR')} UN`;
        $('negLblPreco').textContent = base.tipo === 'CX' ? 'Preço atual (Cx./KG)' : 'Preço atual (Und.)';
        $('negPrecoAtual').textContent = fmt(base.preco);
        $('negCusto').textContent = base.custo > 0 ? fmt(base.custo) : 'Sem custo';

        const r = $('negRentAtual');
        r.textContent = pct(item.rentabilidade);
        r.style.color = rentColor(item.rentabilidade);

        const ja = typeof window.ofertasGetOferta === 'function' ? window.ofertasGetOferta(item.id) : null;
        $('negPreco').value = ja ? String(ja.preco.toFixed(2)).replace('.', ',') : '';
        atualizarResultado();
        if (ja) $('negAviso').textContent = `Já está em "${ja.acao}" com ${fmt(ja.preco)}: será atualizado.`;

        $('modalNegociado').classList.remove('hidden');
        $('negPreco').focus();
        $('negPreco').select();
    }

    function fechar() {
        $('modalNegociado').classList.add('hidden');
    }

    function adicionar() {
        atualizarResultado();
        if (!neg.precoN) {
            $('negAviso').textContent = 'Informe um preço negociado válido (ex.: 12,90).';
            $('negPreco').focus();
            return;
        }
        const res = window.ofertasAdicionarNegociado(neg.item, neg.precoN);
        const msg = `✔ ${neg.item.descricao} enviado para a aba Ofertas (Preço Negociado ${fmt(neg.precoN)}` +
            `${neg.rentN !== null ? ' · Rent. ' + pct(neg.rentN) : ''})${res && res.atualizado ? ' · atualizado' : ''}`;
        fechar();
        toast(msg);
    }

    function init() {
        const tbody = $('tableBody');
        if (!tbody || !$('modalNegociado')) return;

        // Clique na linha do produto (ignora caixinha, links, botões e seleção de texto)
        tbody.addEventListener('click', (e) => {
            if (e.target.closest('input, label, button, a, select, .col-select, .cod-click, [onclick]')) return;
            if (window.getSelection && String(window.getSelection())) return;
            const tr = e.target.closest('tr');
            if (!tr) return;
            const chk = tr.querySelector('.row-select-chk');
            if (!chk) return;
            const id = chk.getAttribute('data-id');
            const lista = (typeof state !== 'undefined' && (state.filteredData || state.rawProcessedData)) || [];
            const item = lista.find(i => i.id === id) ||
                ((typeof state !== 'undefined' && state.rawProcessedData) || []).find(i => i.id === id);
            if (item) abrir(item);
        });

        $('negPreco').addEventListener('input', atualizarResultado);
        $('negPreco').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); adicionar(); }
        });
        $('btnNegAdd').addEventListener('click', adicionar);
        $('btnNegCancel').addEventListener('click', fechar);
        $('btnCloseNeg').addEventListener('click', fechar);
        $('modalNegociado').addEventListener('click', (e) => { if (e.target === $('modalNegociado')) fechar(); });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !$('modalNegociado').classList.contains('hidden')) fechar();
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
