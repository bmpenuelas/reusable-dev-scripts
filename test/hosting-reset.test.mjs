import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir, stat } from 'node:fs/promises'
import { hostingReset } from '../dist/hosting-reset.js'
import { main } from '../dist/cli.js'
import { fixture } from './helpers.mjs'

delete process.env.HOSTINGER_API_TOKEN
delete process.env.CLOUDFLARE_API_TOKEN
const domain = 'api-stage.example.com', project = 'synthetic-stage'
const sitePath = domain => ['', 'home', 'u123456789', 'domains', domain].join('/')
const settings = { version: 1, hostinger: {credentialsFile:'tokens.env',targets:{api:{domain,username:'u123456789',envFile:'backend.env',databaseVariable:'DATABASE_URL',cron:{command:`${sitePath(domain)}/hbuilds/current/nodejs/dist/jobs/cli.js`,schedule:'* * * * *'}}}}, cloudflare:{credentialsFile:'tokens.env',targets:{web:{kind:'pages',projectName:project,accountId:'a'.repeat(32)}}} }
const flags = {env:'staging',yes:true,'confirm-host':domain,'confirm-project':project,output:'state.json'}
const response = (value={},status=200) => new Response(JSON.stringify(value),{status})
async function setup(options={}) {
  const f=await fixture(structuredClone(settings),{...flags,...options.flags})
  if(options.domain) {f.ctx.config.hostinger.targets.api.domain=options.domain;f.ctx.flags['confirm-host']=options.domain}
  const d=f.ctx.config.hostinger.targets.api.domain
  await f.file('tokens.env','HOSTINGER_API_TOKEN=synthetic-host-token\nCLOUDFLARE_API_TOKEN=synthetic-cf-token')
  await f.file('backend.env','DATABASE_URL=mysql://u123456789_stage:synthetic-password@127.0.0.1:3306/u123456789_stage\n')
  f.ctx.runner=async inv=>{f.calls.push(inv);return {stdout:inv.args.includes('--help')?'--entry-file --source --root-directory --output-directory':'{"data":{"buildState":"completed"}}',stderr:''}}
  const sim={sites:[{domain:d,username:'u123456789',order_id:123}, {domain:'production.example.net',username:'u123456789',order_id:123}],dbs:[{name:'u123456789_stage',user:'u123456789_stage',domain:d},{name:'u123456789_prod',user:'u123456789_prod',domain:'production.example.net'}],crons:[{uid:'staging',command:`${sitePath(d)}/old/jobs.js`},{uid:'production',command:`${sitePath('production.example.net')}/jobs.js`}],onboardings:[],project:{name:project,production_branch:'main',subdomain:'synthetic-stage.pages.dev',canonical_deployment:{id:'live'}},deployments:[{id:'live'},...Array.from({length:205},(_,i)=>({id:`old-${i}`}))],domains:[{name:'stage.example.com'}],requests:[],status:'completed',failPages:false}
  const fetcher=async (url,options={})=>{
    sim.requests.push({url,...options});const u=new URL(url),p=u.pathname,m=options.method??'GET'
    if(u.hostname==='api.cloudflare.com') {
      if(p.endsWith('/deployments')){const per=Number(u.searchParams.get('per_page')??'25');if(per>25)return response({success:false,errors:[{code:8000024,message:'Invalid list options provided.'}]},400);return response({result:sim.deployments.slice(0,per)})}
      if(p.includes('/deployments/')&&m==='DELETE'){sim.deployments=sim.deployments.filter(x=>!p.endsWith('/'+x.id));return response()}
      if(p.endsWith('/domains'))return response({result:sim.domains})
      if(p.includes('/domains/')&&m==='DELETE'){sim.domains=[];return response()}
      if(m==='GET')return sim.project?response({result:sim.project}):response({},404)
      if(m==='DELETE'){sim.project=null;sim.deployments=[];if(sim.failPages){sim.failPages=false;return response({error:'synthetic-password'},500)}return response()}
      if(m==='POST'){sim.project={...JSON.parse(options.body),subdomain:'synthetic-stage.pages.dev'};return response({result:sim.project})}
    }
    if(p.endsWith('/websites')&&m==='GET')return response({data:sim.sites})
    if(p.endsWith('/databases')&&m==='GET')return response({data:sim.dbs})
    if(p.includes('/databases/')&&m==='DELETE'){sim.dbs=sim.dbs.filter(x=>!p.endsWith('/'+x.name));return response()}
    if(p.endsWith('/cron-jobs'))return response({data:sim.crons})
    if(p.endsWith('/subdomains')||p.endsWith('/parked-domains'))return response([])
    if(p.includes('/cron-jobs/')&&m==='DELETE'){sim.crons=sim.crons.filter(x=>!p.endsWith('/'+x.uid));return response()}
    if(p.endsWith('/domains/free-subdomains'))return response({domain:'new-stage.hostingersite.com'})
    if(p.includes('/websites/')&&m==='DELETE'){sim.sites=sim.sites.filter(x=>x.domain!==d);return response()}
    if(p.endsWith('/onboardings')&&m==='GET')return response(sim.onboardings.map(x=>({...x,status:sim.status})))
    if(p.endsWith('/onboardings')&&m==='POST'){const site={domain:JSON.parse(options.body).domain,username:'u123456789',order_id:123};sim.sites.push(site);sim.onboardings.push({...site,status:sim.status,created_at:new Date(Date.now()+1000).toISOString()});return response({...site,status:sim.status},201)}
    if(p.endsWith('/ssl/status'))return response({status:'active'})
    throw Error(`Unexpected synthetic request: ${m} ${p}`)
  }
  return {...f,sim,fetcher,run:()=>hostingReset(f.ctx,fetcher,async()=>{})}
}

test('hosting reset dry-run reads no credentials/files, calls no providers/CLI and writes no state',async()=>{
  const f=await fixture(settings,{env:'staging','dry-run':true})
  await hostingReset(f.ctx,async()=>{throw Error('no provider')})
  assert.equal(f.calls.length,0)
  await assert.rejects(stat(f.root+'/.rds'),{code:'ENOENT'})
})
test('hosting reset refuses protected/local envs and mismatched confirmations before effects',async()=>{
  for(const change of [{env:'production'},{env:'development'},{yes:false},{'confirm-host':'wrong.example.com'},{'confirm-project':'wrong'}]){
    const f=await setup({flags:change});await assert.rejects(f.run());assert.equal(f.sim.requests.length,0)
  }
  const f=await setup({flags:{env:'live'}});f.ctx.config.production={environments:['live']};await assert.rejects(f.run(),/forbidden/)
})
test('hosting reset recreates whole resources, removes all Pages history and leaves other sites/DB/cron intact',async()=>{
  const f=await setup(),out=await f.run()
  assert.equal(out.phase,7);assert.equal(out.domain,domain)
  assert.equal(out.pagesDomain,'synthetic-stage.pages.dev')
  assert.deepEqual(f.sim.crons.map(x=>x.uid),['production'])
  assert.deepEqual(f.sim.dbs.map(x=>x.name),['u123456789_prod'])
  assert.ok(f.sim.sites.some(x=>x.domain==='production.example.net'))
  assert.equal(f.sim.deployments.length,0)
  assert.equal(f.sim.project.production_branch,'main')
  assert.equal(f.sim.requests.filter(x=>x.method==='DELETE'&&x.url.includes('/deployments/')).length,205)
  assert.ok(f.sim.requests.filter(x=>x.url.includes('/deployments')&&!x.url.includes('/deployments/')).every(x=>Number(new URL(x.url).searchParams.get('per_page'))<=25),'Cloudflare Pages rejects per_page above 25')
  assert.equal(f.calls.length,2)
  assert.deepEqual((await readdir(f.calls[1].args[1])).sort(),['package.json','server.js'])
  const journal=await readFile(f.root+'/state.json','utf8');assert.ok(!journal.includes('synthetic-password')&&!journal.includes('synthetic-host-token'))
})
test('hosting reset allocates and journals a fresh temporary domain automatically',async()=>{
  const f=await setup({domain:'old-stage.hostingersite.com'}),out=await f.run()
  assert.equal(out.domain,'new-stage.hostingersite.com')
  assert.ok(f.sim.requests.some(x=>x.url.endsWith('/domains/free-subdomains')&&x.method==='POST'))
  const onboard=f.sim.requests.find(x=>x.method==='POST'&&x.url.endsWith('/onboardings'))
  assert.equal(JSON.parse(onboard.body).domain,out.domain)
})
test('hosting reset check preflights both providers without mutation or journal',async()=>{
  const f=await setup({flags:{check:true,yes:false}});await f.run()
  assert.ok(f.sim.requests.every(x=>x.method==='GET'))
  await assert.rejects(stat(f.root+'/state.json'),{code:'ENOENT'})
})
test('hosting reset detects shared resources and unsupported websites/projects before any mutation',async()=>{
  const changes=[s=>s.sites[0].username='wrong',s=>s.sites[0].parent_domain='parent.example.com',s=>s.sites.push({domain:'child.'+domain,parent_domain:domain}),s=>s.dbs[0].domain='production.example.net',s=>s.dbs.push({name:'other',user:'u123456789_stage'}),s=>s.project.source={type:'github'},s=>s.project.production_branch='staging',s=>s.crons[0].uid=undefined]
  for(const mutate of changes){const f=await setup();mutate(f.sim);await assert.rejects(f.run());assert.ok(f.sim.requests.every(x=>x.method==='GET'))}
})
test('hosting reset provider preflight failure leaves all hosted resources untouched',async()=>{
  const f=await setup()
  await assert.rejects(hostingReset(f.ctx,async(url,opts)=>url.includes('api.cloudflare.com')?response({error:'synthetic-password'},403):f.fetcher(url,opts),async()=>{}),e=>/403/.test(e.message)&&!e.message.includes('synthetic-password'))
  assert.ok(f.sim.requests.every(x=>x.method==='GET'))
})
test('hosting reset resumes a partial destructive run without repeating completed site deletion',async()=>{
  const f=await setup();f.sim.failPages=true
  await assert.rejects(f.run(),/500/)
  assert.equal(JSON.parse(await readFile(f.root+'/state.json','utf8')).phase,3)
  await assert.rejects(f.run(),/interrupted reset/)
  const deletes=f.sim.requests.filter(x=>x.method==='DELETE'&&x.url.includes('/websites/')).length
  f.ctx.flags.resume=true;const out=await f.run();assert.equal(out.phase,7)
  assert.equal(f.sim.requests.filter(x=>x.method==='DELETE'&&x.url.includes('/websites/')).length,deletes)
  await f.run();assert.equal(f.calls.filter(x=>!x.args.includes('--help')).length,1)
})
test('hosting reset fails closed on failed setup and can resume without recreating it',async()=>{
  const f=await setup();f.sim.status='failed';await assert.rejects(f.run(),/setup failed/)
  const creations=f.sim.requests.filter(x=>x.method==='POST'&&x.url.endsWith('/onboardings')).length
  f.sim.status='completed';f.ctx.flags.resume=true;await f.run()
  assert.equal(f.sim.requests.filter(x=>x.method==='POST'&&x.url.endsWith('/onboardings')).length,creations)
})
test('reset CLI exposes confirmations and rejects valued flags before loading config',async()=>{
  const lines=[];await main(['hosting','reset','--help'],undefined,x=>lines.push(x));assert.match(lines.join(),/--confirm-project/)
  await assert.rejects(main(['hosting','reset','--yes=false']),/does not take a value/)
})

test('hosting drop stops with all application services removed, no CLI, no creation and no domain reservation',async()=>{
  const f=await setup({domain:'old-stage.hostingersite.com'})
  const out=await hostingReset(f.ctx,f.fetcher,async()=>{},'drop')
  assert.equal(out.phase,4);assert.equal(out.domain,'old-stage.hostingersite.com')
  assert.equal(f.calls.length,0)
  assert.ok(f.sim.requests.every(x=>x.method==='GET'||x.method==='DELETE'))
  assert.equal(f.sim.project,null)
  assert.equal(f.sim.sites.length,1);assert.equal(f.sim.sites[0].domain,'production.example.net')
  assert.deepEqual(f.sim.dbs.map(x=>x.name),['u123456789_prod'])
  assert.deepEqual(f.sim.crons.map(x=>x.uid),['production'])
})

test('drop keep-pages leaves every Pages asset/domain unchanged; recreate never repeats deletion',async()=>{
  const f=await setup({flags:{'keep-pages':true}}),before=JSON.stringify({project:f.sim.project,deployments:f.sim.deployments,domains:f.sim.domains})
  await hostingReset(f.ctx,f.fetcher,async()=>{},'drop')
  assert.equal(JSON.stringify({project:f.sim.project,deployments:f.sim.deployments,domains:f.sim.domains}),before)
  assert.ok(f.sim.requests.filter(x=>x.url.includes('api.cloudflare.com')).every(x=>x.method==='GET'))
  const deletes=f.sim.requests.filter(x=>x.method==='DELETE').length
  const out=await hostingReset(f.ctx,f.fetcher,async()=>{},'recreate')
  assert.equal(out.phase,7);assert.equal(out.keepPages,true)
  assert.equal(f.sim.requests.filter(x=>x.method==='DELETE').length,deletes)
  assert.equal(JSON.stringify({project:f.sim.project,deployments:f.sim.deployments,domains:f.sim.domains}),before)
  f.ctx.flags.resume=true
  await assert.rejects(hostingReset(f.ctx,f.fetcher,async()=>{},'drop'),/already begun/)
})

test('recreate requires completed drop and retention policy cannot change mid-lifecycle',async()=>{
  const f=await setup();await assert.rejects(hostingReset(f.ctx,f.fetcher,async()=>{},'recreate'),/journal/)
  assert.equal(f.sim.requests.length,0)
  f.sim.failPages=true
  await assert.rejects(hostingReset(f.ctx,f.fetcher,async()=>{},'drop'),/500/)
  await assert.rejects(hostingReset(f.ctx,f.fetcher,async()=>{},'recreate'),/Drop must finish/)
  f.ctx.flags.resume=true;f.ctx.flags['keep-pages']=true
  await assert.rejects(hostingReset(f.ctx,f.fetcher,async()=>{},'drop'),/retention decision/)
})

test('drop/recreate CLI expose split controls but no unsupported keep-db flag',async()=>{
  for(const action of ['drop','recreate']){const messages=[];await main(['hosting',action,'--help'],undefined,line=>messages.push(line));assert.match(messages.join(),/--keep-pages/)}
  await assert.rejects(main(['hosting','drop','--keep-db']),/Unknown option/)
})
