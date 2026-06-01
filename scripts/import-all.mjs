/**
 * Import direct des 3 fichiers Excel GNC → Supabase
 * Usage : SUPABASE_URL=https://xxx.supabase.co SUPABASE_KEY=eyJ... node scripts/import-all.mjs
 */
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import XLSXDefault, * as XLSXNamed from 'xlsx'
const XLSX = XLSXDefault ?? XLSXNamed
import { createClient } from '@supabase/supabase-js'

// ── Config ──────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_KEY

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌  Manque les variables d\'environnement :')
  console.error('   SUPABASE_URL=https://xxx.supabase.co SUPABASE_KEY=eyJ... node scripts/import-all.mjs')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

const COMMERCIALS = {
  CT: { id: 'c1000000-0000-0000-0000-000000000001', name: 'Cédric' },
  EM: { id: 'c1000000-0000-0000-0000-000000000002', name: 'Enzo' },
  LJ: { id: 'c1000000-0000-0000-0000-000000000003', name: 'Laëtitia' },
}

const FILES = [
  '/root/.claude/uploads/0b72d656-e3c5-4618-8052-46b349494e46/5ed50e60-cedric_GNC.xlsx',
  '/root/.claude/uploads/0b72d656-e3c5-4618-8052-46b349494e46/8d832119-Enzo_GNC1.xlsx',
  '/root/.claude/uploads/0b72d656-e3c5-4618-8052-46b349494e46/7dbee955-laeticia_GNC.xlsx',
]

// ── Géocodage ────────────────────────────────────────────────────────
const WORK = { latMin: 44.0, latMax: 48.5, lngMin: 3.0, lngMax: 9.5 }
const CENTER_LAT = 46.2, CENTER_LNG = 5.9
const inWork = (lat, lng) => lat >= WORK.latMin && lat <= WORK.latMax && lng >= WORK.lngMin && lng <= WORK.lngMax
const sleep = ms => new Promise(r => setTimeout(r, ms))

const ABBR = [
  [/\bBD\b/gi,'Boulevard'],[/\bAV\b\.?/gi,'Avenue'],[/\bRTE\b/gi,'Route'],
  [/\bIMP\b\.?/gi,'Impasse'],[/\bZI\b/gi,'Zone Industrielle'],[/\bZA\b/gi,'Zone Artisanale'],
]
function normAddr(s) { if (!s) return ''; let r = s.trim(); for (const [re,rep] of ABBR) r = r.replace(re,rep); return r.replace(/\s{2,}/g,' ').trim() }

function csvEscape(s) { return `"${String(s??'').replace(/"/g,'""')}"` }
function parseCsvRow(line) {
  const res=[]; let cell='',inQ=false
  for (let i=0;i<=line.length;i++){
    const c=line[i]
    if(c==='"'){if(inQ&&line[i+1]==='"'){cell+='"';i++}else inQ=!inQ}
    else if((c===','||c===undefined)&&!inQ){res.push(cell.trim());cell=''}
    else cell+=(c??'')
  }
  return res
}

async function govBatch(items, threshold=0.4) {
  const results = new Array(items.length).fill(null)
  if (!items.length) return results
  try {
    // Inclure la raison sociale comme colonne supplémentaire pour meilleure précision
    const lines = ['adresse,code_postal,ville,name',...items.map(r=>[csvEscape(normAddr(r.addr)),csvEscape(r.cp),csvEscape(r.city),csvEscape(r.company||'')].join(','))]
    const csvText = lines.join('\r\n')
    // En Node.js, on utilise un Buffer pour éviter les problèmes de Blob/FormData
    const boundary = '----GNCBoundary' + Math.random().toString(36).slice(2)
    const CRLF = '\r\n'
    const parts = [
      `--${boundary}${CRLF}Content-Disposition: form-data; name="data"; filename="a.csv"${CRLF}Content-Type: text/csv${CRLF}${CRLF}${csvText}${CRLF}`,
      `--${boundary}${CRLF}Content-Disposition: form-data; name="columns"${CRLF}${CRLF}adresse${CRLF}`,
      `--${boundary}${CRLF}Content-Disposition: form-data; name="columns"${CRLF}${CRLF}code_postal${CRLF}`,
      `--${boundary}${CRLF}Content-Disposition: form-data; name="columns"${CRLF}${CRLF}ville${CRLF}`,
      `--${boundary}${CRLF}Content-Disposition: form-data; name="lat"${CRLF}${CRLF}${CENTER_LAT}${CRLF}`,
      `--${boundary}${CRLF}Content-Disposition: form-data; name="lon"${CRLF}${CRLF}${CENTER_LNG}${CRLF}`,
      `--${boundary}--${CRLF}`,
    ]
    const body = parts.join('')
    const res = await fetch('https://api-adresse.data.gouv.fr/search/csv/', {
      method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      body,
    })
    if (!res.ok) { console.warn('govBatch HTTP', res.status); return results }
    const text = await res.text()
    const rows = text.trim().split('\n')
    const hdr = parseCsvRow(rows[0])
    const latI=hdr.findIndex(h=>h==='result_latitude'), lngI=hdr.findIndex(h=>h==='result_longitude'), scI=hdr.findIndex(h=>h==='result_score')
    if (latI<0||lngI<0) { console.warn('govBatch: colonnes manquantes dans la réponse'); return results }
    rows.slice(1).forEach((line,bi)=>{
      const p=parseCsvRow(line), lat=parseFloat(p[latI]), lng=parseFloat(p[lngI]), sc=parseFloat(p[scI]??0)
      if(!isNaN(lat)&&!isNaN(lng)&&sc>=threshold&&inWork(lat,lng)) results[bi]={lat,lng,sc,src:'gouv'}
    })
    return results
  } catch(e) { console.warn('govBatch error:', e.message) }
  return results
    const res = await fetch('https://api-adresse.data.gouv.fr/search/csv/', {method:'POST',body})
    if (!res.ok) return results
    const text = await res.text()
    const rows = text.trim().split('\n')
    const hdr = parseCsvRow(rows[0])
    const latI=hdr.findIndex(h=>h==='result_latitude'), lngI=hdr.findIndex(h=>h==='result_longitude'), scI=hdr.findIndex(h=>h==='result_score')
    if (latI<0||lngI<0) return results
    rows.slice(1).forEach((line,bi)=>{
      const p=parseCsvRow(line), lat=parseFloat(p[latI]), lng=parseFloat(p[lngI]), sc=parseFloat(p[scI]??0)
      if(!isNaN(lat)&&!isNaN(lng)&&sc>=threshold&&inWork(lat,lng)) results[bi]={lat,lng,sc,src:'gouv'}
    })
  } catch(e) { console.warn('govBatch error:', e.message) }
  return results
}

async function photon(q) {
  if (!q?.trim()) return null
  try {
    const bbox=`${WORK.lngMin},${WORK.latMin},${WORK.lngMax},${WORK.latMax}`
    const url=`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=1&lat=${CENTER_LAT}&lon=${CENTER_LNG}&bbox=${bbox}`
    const res = await fetch(url, {headers:{'User-Agent':'GNCMap/1.0'}})
    if (!res.ok) return null
    const d = await res.json()
    if (!d.features?.length) return null
    const [lng,lat] = d.features[0].geometry.coordinates
    if (!inWork(lat,lng)) return null
    return {lat,lng,sc:0.6,src:'photon'}
  } catch { return null }
}

async function geocodeAll(rows) {
  const total = rows.length
  const results = new Array(total).fill(null)
  const items = rows.map((r,i)=>({i, addr:r.address||'', cp:r.postcode||'', city:r.city||'', company:r.name||''}))

  // Phase 1 : data.gouv.fr batch
  process.stdout.write(`  [1/4] data.gouv.fr batch...`)
  const g1 = await govBatch(items, 0.4)
  g1.forEach((g,bi)=>{ if(g) results[items[bi].i]=g })
  const c1 = results.filter(Boolean).length
  console.log(` ${c1}/${total}`)

  // Phase 2 : Photon parallèle (5 à la fois) pour les restants
  const fail1 = items.filter(r=>!results[r.i])
  if (fail1.length) {
    process.stdout.write(`  [2/4] Photon (${fail1.length} restants)...`)
    const CONC = 5
    let done = 0
    for (let i=0; i<fail1.length; i+=CONC) {
      const chunk = fail1.slice(i, i+CONC)
      const geos = await Promise.all(chunk.map(async r=>{
        // 1. adresse + CP + ville
        const q1 = [normAddr(r.addr),r.cp,r.city].filter(Boolean).join(' ')
        let g = q1.trim() ? await photon(q1) : null
        // 2. raison sociale + CP + ville
        if (!g && r.company && (r.city||r.cp))
          g = await photon([r.company,r.cp,r.city].filter(Boolean).join(' '))
        // 3. CP + ville seule
        if (!g && (r.city||r.cp))
          g = await photon([r.cp,r.city].filter(Boolean).join(' '))
        return g
      }))
      geos.forEach((g,bi)=>{ if(g) results[fail1[i+bi].i]=g })
      done += chunk.length
      process.stdout.write(`\r  [2/4] Photon ${done}/${fail1.length}...  `)
      if (i+CONC < fail1.length) await sleep(150)
    }
    const c2 = results.filter(Boolean).length
    console.log(`\r  [2/4] Photon: +${c2-c1} → ${c2}/${total}           `)
  }

  // Phase 3 : data.gouv.fr score bas (0.25)
  const fail2 = items.filter(r=>!results[r.i])
  if (fail2.length) {
    process.stdout.write(`  [3/4] data.gouv.fr score bas...`)
    const g3 = await govBatch(fail2, 0.25)
    g3.forEach((g,bi)=>{ if(g) results[fail2[bi].i]={...g,approx:true} })
    const c3 = results.filter(Boolean).length
    console.log(` +${c3-results.filter(Boolean).length} → ${c3}/${total}`)
  }

  // Phase 4 : ville seule
  const fail3 = items.filter(r=>!results[r.i]&&(r.city||r.cp))
  if (fail3.length) {
    process.stdout.write(`  [4/4] Ville seule (${fail3.length})...`)
    const cityItems = fail3.map(r=>({...r,addr:''}))
    const g4 = await govBatch(cityItems, 0.0)
    g4.forEach((g,bi)=>{ if(g) results[fail3[bi].i]={...g,approx:true,cityOnly:true} })
    const c4 = results.filter(Boolean).length
    console.log(` ${c4}/${total}`)
  }

  return results
}

// ── Parser Excel ─────────────────────────────────────────────────────
const str = v => String(v??'').trim()
const normalizeType = v => { const s=str(v).toLowerCase(); if(s==='1') return 'chantier'; if(s==='0') return 'siege'; if(s.includes('siège')||s.includes('siege')||s.includes('social')) return 'siege'; return 'chantier' }
const normalizeStatus = v => { const s=str(v).toLowerCase(); if(s.includes('client')) return 'client'; if(s.includes('cours')||s.includes('actif')||s==='1') return 'en_cours'; if(s.includes('termin')||s==='0') return 'termine'; return 'prospect' }

function parseFile(path) {
  const wb = XLSX.readFile(path)
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' })

  return rows.map(r => {
    const code = str(r['Code Représentant']).toUpperCase()
    const comm = COMMERCIALS[code]
    if (!comm) { console.warn(`  ⚠ Code inconnu: ${code}`) }
    const name = str(r['Raison sociale']) || str(r['Code client'])
    if (!name) return null

    return {
      commercial_id: comm?.id ?? COMMERCIALS.EM.id,
      name,
      company: str(r['Raison sociale']) || null,
      type: normalizeType(r['Chantier']),
      status: normalizeStatus(r['Type']),
      address: str(r['Adresse']) || null,
      postcode: str(r['C.P.']).replace(/\s/g,'') || null,
      city: str(r['Ville']) || null,
      phone: str(r['Téléphone']) || null,
      email: str(r['Adresse Email 1']) || null,
      notes: null,
      external_id: str(r['Code client']) || null,
    }
  }).filter(Boolean)
}

// ── Import principal ─────────────────────────────────────────────────
async function run() {
  console.log('🚀  Import GNC — 3 fichiers Excel\n')

  // 1. Récupérer les external_ids déjà en base
  console.log('📋  Récupération des IDs existants...')
  const { data: existingSites } = await supabase.from('sites').select('id, external_id, deleted')
  const existingMap = new Map((existingSites||[]).map(s=>[s.external_id, s]))
  console.log(`    ${existingMap.size} sites déjà en base\n`)

  const batchId = crypto.randomUUID()
  let totalInserted=0, totalUpdated=0, totalSkipped=0, totalNoGeo=0

  for (const filePath of FILES) {
    const fileName = filePath.split('/').pop()
    console.log(`📄  ${fileName}`)
    const rows = parseFile(filePath)
    console.log(`    ${rows.length} lignes valides`)

    // Géocodage
    console.log('  🌍  Géocodage...')
    const geoResults = await geocodeAll(rows)
    const noGeo = geoResults.filter(g=>!g).length
    totalNoGeo += noGeo
    if (noGeo) console.log(`  ⚠  ${noGeo} sites sans coordonnées GPS`)

    // Séparer inserts / updates
    const toInsert=[], toUpdate=[]
    rows.forEach((row,i)=>{
      const payload = {
        ...row,
        lat: geoResults[i]?.lat ?? null,
        lng: geoResults[i]?.lng ?? null,
        import_batch_id: batchId,
        updated_at: new Date().toISOString(),
      }
      if (row.external_id && existingMap.has(row.external_id)) {
        const ex = existingMap.get(row.external_id)
        if (ex.deleted) { totalSkipped++; return }
        toUpdate.push({ id: ex.id, payload })
      } else {
        toInsert.push(payload)
      }
    })

    // Batch insert par 500
    const CHUNK = 500
    for (let i=0; i<toInsert.length; i+=CHUNK) {
      const chunk = toInsert.slice(i, i+CHUNK)
      const { error } = await supabase.from('sites').insert(chunk)
      if (error) {
        console.error('  ❌  Insert error:', error.message)
        // Retry individuel
        for (const p of chunk) {
          const { error:e2 } = await supabase.from('sites').insert(p)
          e2 ? totalSkipped++ : totalInserted++
        }
      } else {
        totalInserted += chunk.length
      }
    }

    // Updates individuels
    for (const { id, payload } of toUpdate) {
      const { error } = await supabase.from('sites').update(payload).eq('id', id)
      error ? totalSkipped++ : totalUpdated++
    }

    console.log(`  ✅  +${toInsert.length} insérés, ${toUpdate.length} mis à jour\n`)
  }

  // Log d'import
  await supabase.from('import_logs').insert({
    filename: 'Import_initial_3_fichiers.xlsx',
    total: totalInserted + totalUpdated + totalSkipped,
    inserted: totalInserted,
    updated: totalUpdated,
    skipped: totalSkipped,
    batch_id: batchId,
  })

  console.log('═══════════════════════════════════')
  console.log(`✅  ${totalInserted} ajoutés`)
  console.log(`🔄  ${totalUpdated} mis à jour`)
  console.log(`⏭   ${totalSkipped} ignorés (supprimés)`)
  console.log(`📍  ${totalNoGeo} sans coordonnées GPS`)
  console.log('═══════════════════════════════════')
}

run().catch(err => { console.error('Fatal:', err); process.exit(1) })
