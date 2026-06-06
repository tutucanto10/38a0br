#!/usr/bin/env node
/**
 * baixar_fotos.js
 * Lê o array TIMES do index.html e baixa a foto de cada jogador da Wikipedia.
 * Salva em: faces/{time}-{ano}/{nome}.jpg  (mesmo caminho que o jogo usa)
 *
 * Uso: node baixar_fotos.js
 * Requisitos: Node 18+  (sem dependências externas)
 */

const fs   = require("fs");
const path = require("path");
const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf-8");

// ─── Extrai o array TIMES do HTML ──────────────────────────────────────────
const match = html.match(/const TIMES\s*=\s*(\[[\s\S]*?\]);/);
if (!match) { console.error("Array TIMES não encontrado em index.html"); process.exit(1); }
const TIMES = eval(match[1]); // eslint-disable-line no-eval

// ─── slugify (igual ao do jogo) ──────────────────────────────────────────────
function slugify(s) {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
          .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// ─── Jogadores famosos: busca só pelo nome ────────────────────────────────────
const FAMOSOS = new Set([
  "Pelé","Garrincha","Zico","Romário","Ronaldo","Rivaldo","Ronaldinho Gaúcho",
  "Falcão","Rogério Ceni","Roberto Carlos","Cafu","Marcelo","Roberto Dinamite",
  "Juninho Pernambucano","Jairzinho","Carlos Alberto","Nilton Santos","Tostão",
  "Gérson","Júnior","Didi","Dirceu Lopes","Ademir da Guia","Sócrates","Raí",
  "Bebeto","Edmundo","Taffarel","Dida","Romário","Robinho","Hulk","Gabigol",
  "De Arrascaeta","Cássio","Fred","Conca","Hernanes","Paulinho","Felipe Melo",
  "Elano","Everton Cebolinha","Everton Ribeiro","Germán Cano","Pedro","André",
  "Endrick","Vitor Roque","Renato Gaúcho","Jardel","Müller","Dadá Maravilha",
  "Marcelinho Carioca","Carlos Tévez","Kléberson","Andrés D'Alessandro",
  "Lucho González","Arthur","Raphael Veiga","Weverton","Dudu","Leandro",
  "Piazza","Zagallo","Amarildo","Afonsinho","Leivinha",
]);

// ─── Utilitários ─────────────────────────────────────────────────────────────
const DELAY_MS     = 2000;  // pausa entre jogadores
const RETRY_DELAY  = 15000; // espera após rate-limit (15s)
const MAX_RETRIES  = 3;

const sleep = ms => new Promise(r => setTimeout(r, ms));

const HEADERS = { "User-Agent": "38A0BR-PhotoBot/1.0 (educational project; contact: a.canto@dommainc.com.br)" };

function montarQuery(nome, clube, ano) {
  if (FAMOSOS.has(nome)) return `${nome} futebolista`;
  return `${nome} ${clube} ${ano} futebolista`;
}

async function apiGet(url, tentativa = 0) {
  const r = await fetch(url, { headers: HEADERS });
  if (r.status === 429) {
    if (tentativa >= MAX_RETRIES) throw new Error("Rate limit após " + MAX_RETRIES + " tentativas");
    const wait = RETRY_DELAY * (tentativa + 1);
    process.stdout.write(`[429 – aguardando ${wait/1000}s] `);
    await sleep(wait);
    return apiGet(url, tentativa + 1);
  }
  const text = await r.text();
  if (text.startsWith("You are")) {
    if (tentativa >= MAX_RETRIES) throw new Error("Rate limit (texto)");
    const wait = RETRY_DELAY * (tentativa + 1);
    process.stdout.write(`[ratelimit – aguardando ${wait/1000}s] `);
    await sleep(wait);
    return apiGet(url, tentativa + 1);
  }
  return JSON.parse(text);
}

async function buscarFoto(query) {
  // Tenta PT, cai para EN se não achar foto
  for (const wiki of ["pt.wikipedia.org", "en.wikipedia.org"]) {
    const buscaURL =
      `https://${wiki}/w/api.php?action=query&list=search` +
      `&srsearch=${encodeURIComponent(query)}&format=json&srlimit=1&origin=*`;
    const j   = await apiGet(buscaURL);
    const hit = j?.query?.search?.[0];
    if (!hit) continue;

    const imgURL =
      `https://${wiki}/w/api.php?action=query` +
      `&titles=${encodeURIComponent(hit.title)}` +
      `&prop=pageimages&pithumbsize=400&format=json&origin=*`;
    await sleep(800);
    const j2   = await apiGet(imgURL);
    const page = Object.values(j2?.query?.pages || {})[0];
    const src  = page?.thumbnail?.source ?? null;
    if (src) return { titulo: hit.title, foto: src };
    await sleep(800);
  }
  return null;
}

async function baixar(url, dest) {
  const r = await fetch(url, { headers: HEADERS });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  const ok = buf[0] === 0xFF || buf[0] === 0x89; // JPEG ou PNG
  if (!ok) throw new Error("Resposta não é imagem");
  fs.writeFileSync(dest, buf);
}

// ─── Montagem da lista de jogadores ──────────────────────────────────────────
// Evita buscar o mesmo jogador+clube mais de uma vez (aparece em vários anos)
const vistos   = new Set();   // "nome__clube"
const jogList  = [];

for (const t of TIMES) {
  const pasta = path.join(__dirname, "faces", `${slugify(t.time)}-${t.ano}`);
  fs.mkdirSync(pasta, { recursive: true });

  for (const jog of t.jogadores) {
    const chave   = `${jog.nome}__${t.time}`;
    const destJpg = path.join(pasta, `${slugify(jog.nome)}.jpg`);
    jogList.push({ nome: jog.nome, clube: t.time, ano: t.ano, dest: destJpg, chave });
  }
}

// ─── Execução ────────────────────────────────────────────────────────────────
const encontrados    = [];
const naoEncontrados = [];
// cache: nome__clube → caminho (para copiar em vez de rebaixar)
const cacheArq = new Map();

(async () => {
  console.log(`Total de entradas: ${jogList.length}`);

  for (let i = 0; i < jogList.length; i++) {
    const { nome, clube, ano, dest, chave } = jogList[i];
    process.stdout.write(`[${i + 1}/${jogList.length}] ${nome} (${clube} ${ano}) ... `);

    // Já existe arquivo local → pula
    if (fs.existsSync(dest)) { console.log("já existe, pulando."); continue; }

    // Mesmo jogador+clube já foi baixado → copia o arquivo
    if (cacheArq.has(chave)) {
      try { fs.copyFileSync(cacheArq.get(chave), dest); console.log("copiado."); }
      catch { console.log("erro ao copiar."); }
      continue;
    }

    await sleep(DELAY_MS);

    try {
      const res = await buscarFoto(montarQuery(nome, clube, ano));
      if (res?.foto) {
        await baixar(res.foto, dest);
        cacheArq.set(chave, dest);
        encontrados.push(`${nome} | ${clube} ${ano} | pág: ${res.titulo}`);
        console.log("OK");
      } else {
        naoEncontrados.push(`${nome} | ${clube} ${ano} | sem foto na Wikipedia`);
        console.log("sem foto");
      }
    } catch (e) {
      naoEncontrados.push(`${nome} | ${clube} ${ano} | ERRO: ${e.message}`);
      console.log(`erro (${e.message})`);
    }
  }

  const rel =
    `RELATÓRIO DE FOTOS\n==================\n\n` +
    `ENCONTRADOS (${encontrados.length}):\n${encontrados.join("\n")}\n\n` +
    `NÃO ENCONTRADOS (${naoEncontrados.length}):\n${naoEncontrados.join("\n")}\n`;
  fs.writeFileSync(path.join(__dirname, "relatorio_fotos.txt"), rel, "utf-8");

  console.log(`\nConcluído!`);
  console.log(`  Encontrados  : ${encontrados.length}`);
  console.log(`  Não encontrados: ${naoEncontrados.length}`);
  console.log(`  Relatório    : relatorio_fotos.txt`);
})();
