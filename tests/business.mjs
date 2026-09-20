/**
 * ============================================================================
 *  A CLINIC'S FIRST MONTH, AND WHAT IT EARNED
 * ============================================================================
 *  Not a pass/fail suite. This walks the journey a real customer walks and then
 *  prints the money, so the question "will this make anybody money" has an
 *  arithmetic answer rather than an opinion.
 * ============================================================================
 */
import mysql from 'mysql2/promise'
import fs from 'node:fs'
import process from 'node:process'
process.loadEnvFile('.env.local')

const PLATFORM = 'http://localhost:3000'
const SLUG = 'biztest'
const CLINIC = `http://${SLUG}.localhost:3000`
const OWNER = { email: 'biz.owner@example.com', password: 'biztest123' }

const rupees = (paise) => '₹' + (Number(paise) / 100).toLocaleString('en-IN')
const step = (s) => console.log(`\n${s}`)
const done = (s, extra='') => console.log(`   ✓ ${s}${extra ? `  — ${extra}` : ''}`)
const gap  = (s) => console.log(`   ⚠ ${s}`)

const db = await mysql.createConnection({host:process.env.DB_HOST,port:+process.env.DB_PORT,user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME})
const MANIFEST = '.next/dev/server/server-reference-manifest.json'
const ids = new Map()
const loadIds = () => { if (fs.existsSync(MANIFEST)) for (const [id,e] of Object.entries(JSON.parse(fs.readFileSync(MANIFEST,'utf8')).node)) ids.set(e.exportedName,id) }
loadIds()

function mk(){const jar=new Map();return{
  async req(o,p,x={}){const r=await fetch(o+p,{...x,redirect:'manual',headers:{cookie:[...jar].map(([k,v])=>`${k}=${v}`).join('; '),...(x.headers||{})}});
    for(const l of r.headers.getSetCookie?.()||[]){const pr=l.split(';')[0];const i=pr.indexOf('=');jar.set(pr.slice(0,i).trim(),pr.slice(i+1).trim())}return r},
  json(o,p,b){return this.req(o,p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)})},
  async action(o,page,name,args){const id=ids.get(name);if(!id)return{error:'not compiled: '+name};
    const r=await this.req(o,page,{method:'POST',headers:{'Next-Action':id,'Content-Type':'text/plain;charset=UTF-8'},body:JSON.stringify(args)});
    const t=await r.text();const m=[...t.matchAll(/\{"ok":.*?\}(?=\s*$|\n)/gs)];
    if(m.length){try{return JSON.parse(m[m.length-1][0])}catch{}}return{raw:t.slice(0,140)}}}}
async function signIn(s,o,{email,password}){const{csrfToken}=await(await s.req(o,'/api/auth/csrf')).json();
  await s.req(o,'/api/auth/callback/credentials',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({csrfToken,email,password}).toString()});
  return(await(await s.req(o,'/api/auth/session')).json())?.user??null}

async function teardown(){const [r]=await db.execute('SELECT id FROM clinics WHERE slug=?',[SLUG]);
  if(r.length){const id=r[0].id;await db.execute('DELETE FROM payments WHERE clinic_id=?',[id]);
    for(const t of ['consultation_notes','appointments','patient_packages','packages','reviews','availability_rules','time_off','services','platform_invoices','subscriptions'])
      await db.execute(`DELETE FROM ${t} WHERE clinic_id=?`,[id]);
    await db.execute('UPDATE clinics SET owner_user_id=NULL WHERE id=?',[id]);
    await db.execute('DELETE FROM patient_profiles WHERE user_id IN (SELECT id FROM users WHERE clinic_id=?)',[id]);
    await db.execute('DELETE FROM users WHERE clinic_id=?',[id]);await db.execute('DELETE FROM clinics WHERE id=?',[id])}
  await db.execute("DELETE FROM users WHERE email LIKE 'biz.%@example.com'")}
await teardown()

/* ═════════════════ AS THE BUSINESS OWNER: a clinic signs up ═════════════════ */
step('DAY 1 — a physiotherapist finds your pricing page and signs up')
{
  const s = mk()
  const t0 = Date.now()
  const res = await s.json(PLATFORM,'/api/signup',{name:'Dr. Anjali Rao',email:OWNER.email,phone:'9876511111',
    password:OWNER.password,confirmPassword:OWNER.password,clinicName:'Sanjeevani Physiotherapy',slug:SLUG,city:'Pune',planCode:'professional',acceptTerms:true})
  const body = await res.json()
  if(res.status!==201){console.log('   ✗ signup failed',body);process.exit(1)}
  done(`clinic created in ${Date.now()-t0}ms`, `live at ${body.clinicUrl}`)
  done(`${body.trialDays}-day free trial started`, 'no card required')
}
const [[clinic]] = await db.execute('SELECT * FROM clinics WHERE slug=?',[SLUG])
const [[physio]] = await db.execute("SELECT id FROM users WHERE clinic_id=? AND role='physio' LIMIT 1",[clinic.id])
await db.execute("UPDATE clinics SET onboarding_step='done' WHERE id=?",[clinic.id])

const admin = mk(); await signIn(admin,CLINIC,OWNER)

step('DAY 1 — she sets the clinic up')
{
  const VISIT=80000
  await db.execute(`INSERT INTO services (clinic_id,slug,name,short_description,price_paise,home_price_paise,duration_minutes,available_online,available_clinic,available_home,is_active)
    VALUES (?,'back-pain','Back & Neck Pain','Manual therapy and exercise.',?,?,30,1,1,1,1)`,[clinic.id,VISIT,150000])
  // Split shift, two patients at a time in the evening — how a real clinic runs.
  for(let d=1;d<=6;d++){
    await db.execute(`INSERT INTO availability_rules (clinic_id,physio_id,weekday,start_time,end_time,slot_minutes,capacity,mode) VALUES (?,?,?,'09:00:00','13:00:00',30,1,'both')`,[clinic.id,physio.id,d])
    await db.execute(`INSERT INTO availability_rules (clinic_id,physio_id,weekday,start_time,end_time,slot_minutes,capacity,mode) VALUES (?,?,?,'16:00:00','20:00:00',30,2,'both')`,[clinic.id,physio.id,d])
  }
  await admin.req(CLINIC,'/admin/packages'); loadIds()
  const pkg = await admin.action(CLINIC,'/admin/packages','savePackage',[{name:'Back Rehab — 10 sessions',serviceId:'',sessionsCount:'10',priceRupees:'6000',validityDays:'90',isActive:true}])
  done('one treatment, a split shift, and a 10-session package', pkg.ok ? '₹800/visit · ₹6,000 for 10' : 'PACKAGE FAILED')
  const [slots] = await db.execute('SELECT SUM(TIMESTAMPDIFF(MINUTE,start_time,end_time)/30*capacity) c FROM availability_rules WHERE clinic_id=?',[clinic.id])
  done(`capacity: ${Math.round(slots[0].c)} patient-slots a week`, 'evenings take two at a time')
}

step('WEEK 1–4 — the clinic actually runs')
let takings = 0
{
  const [[svc]] = await db.execute('SELECT id,price_paise FROM services WHERE clinic_id=?',[clinic.id])
  const [[pkgRow]] = await db.execute('SELECT id,price_paise,sessions_count FROM packages WHERE clinic_id=?',[clinic.id])

  // 22 patients: 6 buy the package, 16 pay per visit. Realistic for month one.
  let packagePatients=0, visitPatients=0, sessions=0

  /**
   * A unique (day, time, seat) for every appointment.
   *
   * Hand-written rows have to respect the same uniqueness the booking engine
   * enforces — two patients cannot hold the same place. Walking a counter through
   * days x times x seats is the simplest way to guarantee it, and the fact that a
   * naive generator collides is a small proof the index is doing its job.
   */
  let n = 0
  const nextSlot = () => {
    const seat = Math.floor(n / (28 * 8)) % 2
    const day = 1 + Math.floor(n / 8) % 28
    const half = n % 8                       // 16:00–20:00, half-hourly
    n++
    const hh = String(16 + Math.floor(half / 2)).padStart(2, '0')
    const mm = half % 2 ? '30' : '00'
    const eh = String(16 + Math.floor((half + 1) / 2)).padStart(2, '0')
    const em = (half + 1) % 2 ? '30' : '00'
    return { day, start: `${hh}:${mm}:00`, end: `${eh}:${em}:00`, seat }
  }
  for(let i=0;i<22;i++){
    const [u] = await db.execute(`INSERT INTO users (clinic_id,name,email,phone,role,email_verified,is_active)
      VALUES (?,?,?,?,'patient',1,1)`,[clinic.id,`Patient ${i}`,`biz.p${i}@example.com`,`98120000${String(i).padStart(2,'0')}`])
    await db.execute('INSERT INTO patient_profiles (user_id) VALUES (?)',[u.insertId])

    if(i<6){
      // Bought a course. Money arrives once, up front.
      const [pp] = await db.execute(`INSERT INTO patient_packages (clinic_id,patient_id,package_id,name,service_id,sessions_total,price_paise,expires_at,status)
        VALUES (?,?,?,?,?,?,?,DATE_ADD(CURDATE(),INTERVAL 90 DAY),'active')`,
        [clinic.id,u.insertId,pkgRow.id,'Back Rehab — 10 sessions',svc.id,10,pkgRow.price_paise])
      await db.execute(`INSERT INTO payments (clinic_id,patient_package_id,provider,amount_paise,currency,status,method,collected_by)
        VALUES (?,?,'cash',?,'INR','paid','cash',?)`,[clinic.id,pp.insertId,pkgRow.price_paise,physio.id])
      takings += Number(pkgRow.price_paise); packagePatients++
      // They attend 6 of their 10 so far.
      for(let k=0;k<6;k++){ sessions++
        const t = nextSlot()
        await db.execute(`INSERT INTO appointments (clinic_id,code,patient_id,physio_id,service_id,patient_package_id,appointment_date,start_time,end_time,slot_seat,mode,status,amount_paise)
          VALUES (?,?,?,?,?,?,DATE_SUB(CURDATE(),INTERVAL ? DAY),?,?,?,'clinic','completed',0)`,
          [clinic.id,`BIZP${i}${k}`,u.insertId,physio.id,svc.id,pp.insertId,t.day,t.start,t.end,t.seat])
      }
    } else {
      // Pay-per-visit: 3 visits each, cash at the desk.
      visitPatients++
      for(let k=0;k<3;k++){ sessions++
        const t = nextSlot()
        const [ap] = await db.execute(`INSERT INTO appointments (clinic_id,code,patient_id,physio_id,service_id,appointment_date,start_time,end_time,slot_seat,mode,status,amount_paise)
          VALUES (?,?,?,?,?,DATE_SUB(CURDATE(),INTERVAL ? DAY),?,?,?,'clinic','completed',?)`,
          [clinic.id,`BIZV${i}${k}`,u.insertId,physio.id,svc.id,t.day,t.start,t.end,t.seat,svc.price_paise])
        await db.execute(`INSERT INTO payments (clinic_id,appointment_id,provider,amount_paise,currency,status,method,collected_by)
          VALUES (?,?,'cash',?,'INR','paid','cash',?)`,[clinic.id,ap.insertId,svc.price_paise,physio.id])
        takings += Number(svc.price_paise)
      }
    }
  }
  done(`${packagePatients} patients bought a package, ${visitPatients} paid per visit`, `${sessions} sessions delivered`)

  const [[real]] = await db.execute("SELECT COALESCE(SUM(amount_paise-refunded_paise),0) t FROM payments WHERE clinic_id=? AND status IN ('paid','refunded')",[clinic.id])
  // Number() matters: MySQL returns SUM() as a string, so === would always fail
  // and report a mismatch between two identical figures.
  done(`the clinic's dashboard shows ${rupees(real.t)}`,
    Number(real.t) === takings ? 'matches the cash counted exactly' : `MISMATCH, counted ${rupees(takings)}`)

  const perPackage = Number(pkgRow.price_paise)
  const perVisitPatient = Number(svc.price_paise)*3
  console.log(`\n   revenue per patient:  package ${rupees(perPackage)}   vs   per-visit ${rupees(perVisitPatient)}`)
  console.log(`   → a package patient is worth ${(perPackage/perVisitPatient).toFixed(1)}x a per-visit patient`)
}

step('WEEK 5 — the trial ends and she has to decide')
{
  await admin.req(CLINIC,'/admin/billing'); loadIds()
  const sub = await (await admin.json(CLINIC,'/api/billing/subscribe',{planCode:'professional'})).json()
  const ver = await (await admin.json(CLINIC,'/api/billing/verify',{razorpay_subscription_id:sub.subscriptionId,razorpay_payment_id:sub.demoPaymentId,razorpay_signature:'demo'})).json()
  const [[inv]] = await db.execute('SELECT number,amount_paise,tax_paise FROM platform_invoices WHERE clinic_id=?',[clinic.id])
  if(ver.ok) done(`she subscribes — ${inv.number}`, `${rupees(inv.amount_paise)} + ${rupees(inv.tax_paise)} GST`)
  else console.log('   ✗ subscribe failed',ver)

  const monthly = Number(inv.amount_paise)
  console.log(`\n   her month:  earned ${rupees(takings)}   ·   paid you ${rupees(monthly)}   ·   ${(monthly/takings*100).toFixed(1)}% of her revenue`)
  console.log(`   she keeps ${rupees(takings-monthly)}`)
}

step('AS THE BUSINESS OWNER — what the platform sees')
{
  const [[stats]] = await db.execute(`SELECT
      (SELECT COUNT(*) FROM clinics WHERE status<>'cancelled') clinics,
      (SELECT COALESCE(SUM(s.price_paise),0) FROM subscriptions s WHERE s.status='active') mrr,
      (SELECT COALESCE(SUM(amount_paise),0) FROM platform_invoices WHERE status='paid') collected`)
  done(`${stats.clinics} clinics · MRR ${rupees(stats.mrr)} · collected ${rupees(stats.collected)}`)
  console.log(`   annual run rate at this size: ${rupees(Number(stats.mrr)*12)}`)
}

step('WHAT SHE CANNOT DO YET')
{
  const checks = [
    ['send an appointment reminder by WhatsApp', 'nothing sends WhatsApp — and Indian patients do not read email'],
    ['collect the no-show fee automatically', 'the amount is recorded; taking it needs a stored card mandate'],
    ['send the referring doctor a progress note', 'referred_by is free text and nothing reports on it'],
    ['let a patient leave a review', 'the table, the admin approval screen and the SEO markup all exist; the patient-facing form does not'],
    ['reschedule in one step', 'a patient cancels and rebooks, and can lose the slot in between'],
    ['choose which physiotherapist to see', 'multiple therapists can be added, but booking assigns the first active one'],
  ]
  for (const [what,why] of checks) gap(`${what} — ${why}`)
}

await teardown()
console.log('\n(test clinic removed)\n')
await db.end()
