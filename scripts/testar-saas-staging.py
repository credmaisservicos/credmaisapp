"""Real, disposable PostgreSQL/Auth/PostgREST/Storage tenant tests.

No production URL, credential, customer data, SMTP or provider is accepted.
Docker network is internal; no service publishes a host port. The schema
fixture contains structure plus migration version names, never customer rows.
"""
from pathlib import Path
import base64
import concurrent.futures
import hashlib
import hmac
import json
import re
import secrets
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.request
import urllib.parse
import uuid

ROOT = Path(__file__).resolve().parent.parent
PREFIX = 'credmais_saas_qa_' + uuid.uuid4().hex[:12]
NETWORK = PREFIX + '_net'
CONTAINERS = []
SECRET = secrets.token_hex(32)
PASSWORD = secrets.token_hex(24)
CHECKS = []


def docker(*args, stdin=None, timeout=120):
    result = subprocess.run(['docker', *args], input=stdin, capture_output=True,
                            text=True, timeout=timeout)
    if result.returncode:
        # Never echo command args: new credentials are supplied as env values.
        raise RuntimeError('Docker operation failed: ' + result.stderr[-1800:])
    return (result.stdout + (result.stderr if args and args[0] == 'logs' else '')).strip()


def token(role):
    encode = lambda v: base64.urlsafe_b64encode(json.dumps(v, separators=(',', ':')).encode()).rstrip(b'=')
    body = encode({'alg': 'HS256', 'typ': 'JWT'}) + b'.' + encode({'role': role, 'iss': 'supabase', 'iat': int(time.time()), 'exp': int(time.time()) + 3600})
    return (body + b'.' + base64.urlsafe_b64encode(hmac.new(SECRET.encode(), body, hashlib.sha256).digest()).rstrip(b'=')).decode()


def start(label, image, env, port=None, memory='256m', command=(), mounts=None):
    name = PREFIX + '_' + label
    args = ['run', '-d', '--name', name, '--network', NETWORK,
            '--network-alias', label, '--memory', memory, '--cpus', '1', '--pids-limit', '160']
    for key, value in env.items(): args += ['-e', key + '=' + value]
    for source, target in (mounts or {}).items(): args += ['-v', str(source) + ':' + target + ':ro']
    docker(*args, image, *command, timeout=180)
    CONTAINERS.append(name)
    if not port: return name
    detail = json.loads(docker('inspect', name))[0]
    if not detail['State']['Running']:
        raise RuntimeError('Isolated container exited: ' + label)
    # Docker internal networks have no published NAT ports. The Linux runner
    # can reach their bridge address; nothing listens on the VPS public IP.
    address = detail['NetworkSettings']['Networks'][NETWORK]['IPAddress']
    return 'http://' + address + ':' + str(port)


def sql(query):
    return docker('exec', '-i', '-e', 'PGPASSWORD=' + PASSWORD, PREFIX + '_db', 'psql', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'postgres',
                  '-At', '-v', 'ON_ERROR_STOP=1', stdin=query, timeout=60)


def http(base, path, auth=None, method='GET', data=None, raw=None, headers=None):
    payload = raw if raw is not None else (json.dumps(data).encode() if data is not None else None)
    head = {'Content-Type': 'application/json', **(headers or {})}
    if auth: head['Authorization'] = 'Bearer ' + auth
    request = urllib.request.Request(base + path, data=payload, method=method, headers=head)
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            body = response.read()
            return response.status, json.loads(body) if body and response.headers.get('Content-Type', '').startswith('application/json') else body
    except urllib.error.HTTPError as error:
        body = error.read()
        try: return error.code, json.loads(body)
        except ValueError: return error.code, body


def ready(base, path):
    until = time.monotonic() + 40
    while time.monotonic() < until:
        try:
            if http(base, path)[0] < 500: return
        except OSError: pass
        time.sleep(.25)
    raise RuntimeError('Isolated service not ready: ' + path)


def check(name, condition):
    if not condition: raise AssertionError(name)
    CHECKS.append(name)


def main():
    runtime=ROOT / 'test-results/saas/runtime'
    if not (runtime/'main/index.js').is_file():raise RuntimeError('Bundle upload-urls before starting isolated tests')
    docker('network', 'create', '--internal', NETWORK)
    temporary=tempfile.TemporaryDirectory(prefix=PREFIX+'_')
    try:
        start('db', 'postgres:15.8-alpine', {'POSTGRES_PASSWORD': PASSWORD}, memory='512m')
        until = time.monotonic() + 40
        while time.monotonic() < until:
            try: sql('SELECT 1'); break
            except RuntimeError: time.sleep(.25)
        else: raise RuntimeError('Isolated PostgreSQL not ready')
        schema = (ROOT / 'scripts/fixtures/saas-staging/schema.sql').read_text()
        roles = sorted(set(re.findall(r'\b(?:TO|FOR ROLE) (supabase_[a-z_]+|dashboard_user|anon|authenticated|service_role)\b', schema)))
        sql('\n'.join(f'CREATE ROLE {role} NOLOGIN' + (' BYPASSRLS' if role == 'service_role' else '') + ';' for role in roles)
            + f"\nCREATE ROLE authenticator LOGIN NOINHERIT PASSWORD '{PASSWORD}'; GRANT anon,authenticated,service_role TO authenticator;"
            + '\nCREATE EXTENSION pgcrypto; CREATE EXTENSION pg_trgm; CREATE EXTENSION "uuid-ossp";')
        sql(schema)
        # Apply only changes newer than this reviewed structural snapshot.
        for migration in sorted((ROOT / 'supabase/migrations').glob('*.sql')):
            if migration.name > '20261008030000_secure_rate_limit_rpc.sql':
                sql(migration.read_text(encoding='utf-8-sig'))
        conn = f'postgres://postgres:{PASSWORD}@db:5432/postgres'
        auth = start('auth', 'supabase/gotrue:v2.186.0', {
            'GOTRUE_API_HOST': '0.0.0.0', 'GOTRUE_API_PORT': '9999', 'API_EXTERNAL_URL': 'http://auth:9999',
            'GOTRUE_DB_DRIVER': 'postgres', 'GOTRUE_DB_DATABASE_URL': conn + '?search_path=auth',
            'GOTRUE_SITE_URL': 'http://staging.invalid', 'GOTRUE_DISABLE_SIGNUP': 'true',
            'GOTRUE_JWT_ADMIN_ROLES': 'service_role', 'GOTRUE_JWT_AUD': 'authenticated',
            'GOTRUE_JWT_DEFAULT_GROUP_NAME': 'authenticated', 'GOTRUE_JWT_SECRET': SECRET,
            'GOTRUE_JWT_EXP': '3600', 'GOTRUE_EXTERNAL_EMAIL_ENABLED': 'true',
            'GOTRUE_MAILER_AUTOCONFIRM': 'true', 'GOTRUE_EXTERNAL_PHONE_ENABLED': 'false'}, 9999)
        rest = start('rest', 'postgrest/postgrest:v14.8', {
            'PGRST_DB_URI': f'postgres://authenticator:{PASSWORD}@db:5432/postgres',
            'PGRST_DB_SCHEMAS': 'public', 'PGRST_DB_ANON_ROLE': 'anon',
            'PGRST_JWT_SECRET': SECRET, 'PGRST_DB_MAX_ROWS': '1000'}, 3000, memory='128m')
        anon, service = token('anon'), token('service_role')
        storage = start('storage', 'supabase/storage-api:v1.48.26', {
            'ANON_KEY': anon, 'SERVICE_KEY': service, 'POSTGREST_URL': 'http://rest:3000',
            'AUTH_JWT_SECRET': SECRET, 'DATABASE_URL': conn, 'STORAGE_BACKEND': 'file',
            'FILE_STORAGE_BACKEND_PATH': '/var/lib/storage', 'TENANT_ID': 'saas-synthetic',
            'REGION': 'local', 'GLOBAL_S3_BUCKET': 'staging', 'FILE_SIZE_LIMIT': '1048576',
            'ENABLE_IMAGE_TRANSFORMATION': 'false'}, 5000)
        proxy=Path(temporary.name)/'gateway.conf'
        proxy.write_text('''server {
          listen 8080;
          location /auth/v1/ { proxy_pass http://auth:9999/; }
          location /rest/v1/ { proxy_pass http://rest:3000/; }
          location /storage/v1/ { proxy_pass http://storage:5000/; }
        }''')
        gateway=start('gateway','nginx:stable-alpine',{},8080,memory='64m',mounts={proxy:'/etc/nginx/conf.d/default.conf'})
        uploads=start('uploads','supabase/edge-runtime:v1.71.2',{
            'SUPABASE_URL':'http://gateway:8080','SUPABASE_PUBLIC_URL':gateway,
            'SUPABASE_ANON_KEY':anon,'SUPABASE_SERVICE_ROLE_KEY':service},9000,
            command=('start','--main-service','/home/deno/functions/main'),mounts={runtime:'/home/deno/functions'})
        ready(auth, '/health'); ready(rest, '/'); ready(storage, '/status');ready(uploads,'/')
        owners = []
        for label in ['A', 'B']:
            email = f'company-{label.lower()}@staging.invalid'
            status, user = http(auth, '/admin/users', service, 'POST', {'email': email, 'password': PASSWORD, 'email_confirm': True, 'user_metadata': {'name': 'Empresa fictícia ' + label}})
            check('create synthetic Auth ' + label, status == 200 and bool(user.get('id')))
            status, session = http(auth, '/token?grant_type=password', method='POST', data={'email': email, 'password': PASSWORD})
            check('real password login ' + label, status == 200 and bool(session.get('access_token')))
            owner = {'id': user['id'], 'jwt': session['access_token'], 'client': str(uuid.uuid4()), 'contract': str(uuid.uuid4()),
                     'installments': [str(uuid.uuid4()), str(uuid.uuid4())], 'collector': str(uuid.uuid4()), 'collector_token': secrets.token_hex(20), 'portal': str(uuid.uuid4()),
                     'investor':str(uuid.uuid4()),'investor_token':str(uuid.uuid4()),'investor_loan':str(uuid.uuid4())}
            owners.append(owner)
            sql(f"""UPDATE public.profiles SET subscription_expires_at=now()+interval '1 year',is_admin=false WHERE id='{owner['id']}';
              INSERT INTO public.settings(user_id,company_name,bot_enabled,bot_auto_send) VALUES('{owner['id']}','Empresa {label}',false,false) ON CONFLICT(user_id) DO UPDATE SET company_name=EXCLUDED.company_name,bot_enabled=false,bot_auto_send=false;
              INSERT INTO public.clients(id,user_id,name,cpf_cnpj,phone,birth_date) VALUES('{owner['client']}','{owner['id']}','Cliente {label}','11144477735','11987654321',(now() AT TIME ZONE 'America/Sao_Paulo')::date);
              INSERT INTO public.contracts(id,user_id,client_id,capital,total_amount,total_interest,num_installments,installment_amount,status) VALUES('{owner['contract']}','{owner['id']}','{owner['client']}',180,200,20,2,100,'active');
              INSERT INTO public.contract_installments(id,user_id,client_id,contract_id,installment_number,amount,due_date,scheduled_principal,scheduled_interest) VALUES
              ('{owner['installments'][0]}','{owner['id']}','{owner['client']}','{owner['contract']}',1,100,now()+interval '1 day',90,10),
              ('{owner['installments'][1]}','{owner['id']}','{owner['client']}','{owner['contract']}',2,100,now()+interval '2 days',90,10);
              INSERT INTO public.collectors(id,user_id,name,phone,city,state) VALUES('{owner['collector']}','{owner['id']}','Cobrador {label}','11911112222','Cidade fictícia','SP');
              INSERT INTO public.collector_tokens(user_id,collector_id,token) VALUES('{owner['id']}','{owner['collector']}','{owner['collector_token']}');
              INSERT INTO public.collector_assignments(user_id,collector_id,client_id) VALUES('{owner['id']}','{owner['collector']}','{owner['client']}');
              INSERT INTO public.portal_sessions(token,client_id) VALUES('{owner['portal']}','{owner['client']}');
              INSERT INTO public.investors(id,user_id,name,access_token) VALUES('{owner['investor']}','{owner['id']}','Investidor {label}','{owner['investor_token']}');
              INSERT INTO public.investor_loans(id,user_id,investor_id,principal,total_due,due_date) VALUES('{owner['investor_loan']}','{owner['id']}','{owner['investor']}',100,110,current_date+30);""")
        status, _ = http(storage, '/bucket', service, 'POST', {'id': 'uploads', 'name': 'uploads', 'public': False})
        check('private upload bucket', status == 200)
        for own, other in [owners, list(reversed(owners))]:
            label = own['id'][:8]
            for table in ['clients', 'contracts', 'contract_installments', 'collectors', 'collector_assignments', 'collector_tokens', 'transactions', 'settings_safe']:
                status, rows = http(rest, f'/{table}?select=*', own['jwt'])
                check(f'{label}: own rows only in {table}', status == 200 and len(rows) > 0 and all(row.get('user_id') == own['id'] for row in rows))
            status, rows = http(rest, '/clients?id=eq.' + other['client'], own['jwt'], 'PATCH', {'name': 'Forbidden edit'}, headers={'Prefer': 'return=representation'})
            check(label + ': foreign update invisible', status == 200 and rows == [])
            status, _ = http(rest, '/clients', own['jwt'], 'POST', {'user_id': other['id'], 'name': 'Forbidden insert'})
            check(label + ': foreign owner insert denied', status == 403)
            status, _ = http(rest, '/contracts', own['jwt'], 'POST', {
                'user_id': own['id'], 'client_id': other['client'], 'capital': 90,
                'num_installments': 1, 'installment_amount': 100, 'total_amount': 100})
            check(label + ': own contract cannot reference foreign client (HTTP ' + str(status) + ')', status == 403)
            status, _ = http(rest, '/collector_assignments', own['jwt'], 'POST', {
                'user_id': own['id'], 'collector_id': own['collector'], 'client_id': other['client']})
            check(label + ': own assignment cannot reference foreign client', status == 403)
            status, _ = http(rest, '/collector_tokens', own['jwt'], 'POST', {
                'user_id': own['id'], 'collector_id': other['collector'], 'token': secrets.token_hex(20)})
            check(label + ': own token cannot reference foreign collector', status == 403)
            status, rows = http(rest, '/contracts', own['jwt'], 'POST', {
                'user_id': own['id'], 'client_id': own['client'], 'origin_contract_id': own['contract'],
                'capital': 90, 'num_installments': 1, 'installment_amount': 100, 'total_amount': 100},
                headers={'Prefer': 'return=representation'})
            check(label + ': own referenced contract remains writable', status == 201 and rows[0]['user_id'] == own['id'])
            status, _ = http(rest, '/contracts', own['jwt'], 'POST', {
                'user_id': own['id'], 'client_id': own['client'], 'origin_contract_id': other['contract'],
                'capital': 90, 'num_installments': 1, 'installment_amount': 100, 'total_amount': 100})
            check(label + ': foreign origin contract denied', status == 403)
            status, _ = http(rest, '/contract_installments', own['jwt'], 'POST', {
                'user_id': own['id'], 'client_id': other['client'], 'contract_id': own['contract'],
                'installment_number': 3, 'amount': 100, 'due_date': '2030-01-01T12:00:00Z'})
            check(label + ': installment cannot bind foreign client', status == 403)
            status, _ = http(rest, '/transactions', own['jwt'], 'POST', {
                'user_id': own['id'], 'client_id': other['client'], 'amount': 5,
                'type': 'payment', 'description': 'Synthetic foreign reference'})
            check(label + ': money cannot bind foreign client', status == 403)
            status, _=http(rest,'/investor_loans',own['jwt'],'POST',{'user_id':own['id'],'investor_id':other['investor'],'principal':100,'total_due':110,'due_date':'2030-01-01'})
            check(label + ': investor loan cannot bind foreign investor',status==403)
            status, _=http(rest,'/investor_payments',own['jwt'],'POST',{'user_id':own['id'],'investor_id':other['investor'],'loan_id':other['investor_loan'],'amount':10})
            check(label + ': investor payment cannot bind foreign loan',status==403)
            status, _=http(rest,'/collection_attempts',own['jwt'],'POST',{'user_id':own['id'],'installment_id':other['installments'][0],'channel':'manual'})
            check(label + ': collection cannot alter another company installment',status==403)
            status, _ = http(rest, '/rpc/pay_installment', own['jwt'], 'POST', {'_installment_id': other['installments'][0], '_paid_total': 100})
            check(label + ': foreign payment denied', status >= 400)
            status, _ = http(rest, '/rpc/reverse_installment_payment', own['jwt'], 'POST', {'_installment_id': other['installments'][0]})
            check(label + ': foreign reversal denied', status >= 400)
            status, portal = http(rest, '/rpc/portal_login_by_token', anon, 'POST', {'_token': own['portal']})
            check(label + ': portal tenant branding and contracts', status == 200 and portal['client']['id'] == own['client'] and len(portal['contracts']) == 2 and all(c['id'] != other['contract'] for c in portal['contracts']))
            status, view = http(rest, '/rpc/collector_login_by_token', anon, 'POST', {'_token': own['collector_token']})
            check(label + ': assigned collector scope', status == 200 and view['owner_id'] == own['id'] and [c['id'] for c in view['clients']] == [own['client']])
            bad_token=secrets.token_hex(20)
            sql(f"INSERT INTO collector_tokens(user_id,collector_id,token) VALUES('{own['id']}','{other['collector']}','{bad_token}');")
            status, view=http(rest,'/rpc/collector_login_by_token',anon,'POST',{'_token':bad_token})
            check(label + ': mismatched legacy collector token cannot open portal',status==200 and view is None)
            status, _=http(rest,'/rpc/collector_register_payment',anon,'POST',{'_token':bad_token,'_installment_id':own['installments'][0],'_paid_total':100})
            check(label + ': mismatched legacy collector token cannot pay',status>=400)
            sql(f"INSERT INTO investor_loans(user_id,investor_id,principal,total_due,due_date) VALUES('{other['id']}','{own['investor']}',999,999,current_date+30);"
                +f"INSERT INTO investor_payments(user_id,investor_id,loan_id,amount) VALUES('{other['id']}','{own['investor']}','{own['investor_loan']}',7);")
            status, view=http(rest,'/rpc/investor_portal_login',anon,'POST',{'_token':own['investor_token']})
            check(label + ': investor portal excludes corrupt foreign history',status==200 and len(view['loans'])==1 and view['loans'][0]['id']==own['investor_loan'] and view['loans'][0]['payments']==[])
            previous=sql(f"SELECT collection_count FROM contract_installments WHERE id='{other['installments'][0]}';")
            sql(f"INSERT INTO collection_attempts(user_id,installment_id,channel) VALUES('{own['id']}','{other['installments'][0]}','manual');")
            check(label + ': privileged wrong reference does not update foreign collection state',sql(f"SELECT collection_count FROM contract_installments WHERE id='{other['installments'][0]}';")==previous)
            status, _ = http(rest, '/rpc/collector_register_payment', anon, 'POST', {'_token': own['collector_token'], '_installment_id': other['installments'][0], '_paid_total': 100})
            check(label + ': collector foreign payment denied', status >= 400)
            args={'_token': own['collector_token'], '_installment_id': own['installments'][0], '_paid_total': 20}
            status, _ = http(rest, '/rpc/collector_register_payment', anon, 'POST', args)
            check(label + ': collector cannot alter full-payment amount', status >= 400)
            args['_paid_total']=100
            status, _ = http(rest, '/rpc/collector_register_payment', anon, 'POST', args)
            check(label + ': assigned collector full payment accepted', status == 200)
            status, result = http(rest, '/rpc/collector_register_payment', anon, 'POST', args)
            check(label + ': repeated cumulative collector payment adds zero', status == 200 and float(result['new_money']) == 0)
            status, _ = http(rest, '/rpc/reverse_installment_payment', own['jwt'], 'POST', {'_installment_id': own['installments'][0]})
            check(label + ': owner reverses collector receipt', status == 200)
            status, _ = http(rest, '/rpc/pay_installment', own['jwt'], 'POST', {'_installment_id': own['installments'][0], '_paid_total': 20, '_mark_paid': False, '_source_key': 'synthetic-older-partial-' + label})
            check(label + ': owner partial on older installment accepted', status == 200)
            # Human classification uses the actual payment ledger and real
            # PostgREST authentication. All documents/accounts are synthetic.
            inst=own['installments'][0]
            detail_args={'_installment_id':inst}
            status, detail=http(rest,'/rpc/payment_classification_detail',own['jwt'],'POST',detail_args)
            check(label + ': authenticated receipt classification detail',status==200 and detail['can_reconcile'] and len(detail['transactions'])==1)
            tx=detail['transactions'][0]
            snapshot="SELECT md5(jsonb_build_object('installment',(SELECT to_jsonb(i)-'paid_principal'-'paid_interest'-'paid_fees' FROM contract_installments i WHERE id='"+inst+"'),'transactions',(SELECT jsonb_agg(to_jsonb(t)-'principal_amount'-'interest_amount'-'fee_amount'-'unallocated_amount' ORDER BY id) FROM transactions t WHERE installment_id='"+inst+"'),'contract',(SELECT to_jsonb(c) FROM contracts c WHERE id='"+own['contract']+"'),'outbox',(SELECT jsonb_agg(to_jsonb(w) ORDER BY id) FROM whatsapp_scheduled_messages w))::text);"
            original=sql(snapshot)
            classify={'_request_id':str(uuid.uuid4()),'_expected_owner':own['id'],'_transaction_id':tx['id'],'_expected_version':detail['version'],
                      '_principal':15,'_interest':4,'_fees':1,'_reason':'Conferência humana fictícia STAGING-001','_evidence':'Extrato fictício STAGING-001','_confirmed':True}
            status, _=http(rest,'/rpc/payment_classification_detail',other['jwt'],'POST',detail_args)
            check(label + ': foreign classification detail denied',status>=400)
            status, _=http(rest,'/rpc/reclassify_payment_receipt',anon,'POST',classify)
            check(label + ': anonymous classification denied',status>=400)
            status, _=http(rest,'/rpc/reclassify_payment_receipt',other['jwt'],'POST',classify)
            check(label + ': foreign classification denied',status>=400)
            status, first=http(rest,'/rpc/reclassify_payment_receipt',own['jwt'],'POST',classify)
            check(label + ': owner receipt classified with evidence',status==200 and first['replayed'] is False)
            check(label + ': classification preserves cash dates contract state and outbox',sql(snapshot)==original)
            check(label + ': classified profit derives from real receipt',sql(f"SELECT amount FROM profits WHERE installment_id='{inst}' AND user_id='{own['id']}'")=='5')
            status, again=http(rest,'/rpc/reclassify_payment_receipt',own['jwt'],'POST',classify)
            check(label + ': lost classification response replays safely',status==200 and again['replayed'] is True)
            status, _=http(rest,'/rpc/reclassify_payment_receipt',own['jwt'],'POST',{**classify,'_request_id':str(uuid.uuid4())})
            check(label + ': stale classification version rejected',status>=400)
            status, history=http(rest,'/payment_classification_history?request_id=eq.'+classify['_request_id'],own['jwt'])
            check(label + ': durable authored evidence and snapshots',status==200 and len(history)==1 and history[0]['user_id']==own['id'] and history[0]['evidence']==classify['_evidence'] and history[0]['before_state']!=history[0]['after_state'])
            status, history=http(rest,'/payment_classification_history?request_id=eq.'+classify['_request_id'],other['jwt'])
            check(label + ': foreign company cannot read classification journal',status==200 and history==[])
            status, _=http(rest,'/payment_classification_history?request_id=eq.'+classify['_request_id'],own['jwt'],'PATCH',{'reason':'Alteração indevida do histórico'})
            check(label + ': owner cannot overwrite classification journal',status>=400)
            cancel_args={'_request_id':classify['_request_id'],'_expected_owner':own['id']}
            status, settled=http(rest,'/rpc/cancel_payment_classification',own['jwt'],'POST',cancel_args)
            check(label + ': ending lost response confirms already applied classification',status==200 and settled['cancelled'] is False)
            cancelled={**classify,'_request_id':str(uuid.uuid4())}
            status, result=http(rest,'/rpc/cancel_payment_classification',own['jwt'],'POST',{'_request_id':cancelled['_request_id'],'_expected_owner':own['id']})
            check(label + ': pending classification cancellation confirmed',status==200 and result['cancelled'] is True)
            status, _=http(rest,'/rpc/reclassify_payment_receipt',own['jwt'],'POST',cancelled)
            check(label + ': cancelled classification late arrival blocked',status>=400)
            # Two real HTTP/DB sessions, never a mocked concurrency result.
            _, current=http(rest,'/rpc/payment_classification_detail',own['jwt'],'POST',detail_args)
            concurrent_args={**classify,'_expected_version':current['version'],'_principal':14,'_interest':5}
            barrier=threading.Barrier(2)
            def concurrent_classification(index):
                barrier.wait(timeout=5)
                return http(rest,'/rpc/reclassify_payment_receipt',own['jwt'],'POST',{**concurrent_args,'_request_id':str(uuid.uuid4())})
            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
                results=list(pool.map(concurrent_classification,range(2)))
            check(label + ': concurrent different classification intents apply once',sorted(r[0] for r in results)==[200,400])
            _, current=http(rest,'/rpc/payment_classification_detail',own['jwt'],'POST',detail_args)
            concurrent_args={**classify,'_request_id':str(uuid.uuid4()),'_expected_version':current['version'],'_principal':13,'_interest':6}
            barrier=threading.Barrier(2)
            def concurrent_replay(index):
                barrier.wait(timeout=5)
                return http(rest,'/rpc/reclassify_payment_receipt',own['jwt'],'POST',concurrent_args)
            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
                results=list(pool.map(concurrent_replay,range(2)))
            check(label + ': concurrent identical classification has one replay',all(r[0]==200 for r in results) and sorted(r[1]['replayed'] for r in results)==[False,True])
            check(label + ': classification concurrency preserves cash and produces three audits',sql(snapshot)==original and sql(f"SELECT count(*) FROM payment_classification_history WHERE installment_id='{inst}' AND user_id='{own['id']}'")=='3')
            path = own['id'] + '/fixture.txt'
            status, _ = http(storage, '/object/uploads/' + path, own['jwt'], 'POST', raw=b'synthetic private file', headers={'Content-Type': 'text/plain'})
            check(label + ': own authenticated upload', status == 200)
            status, _ = http(storage, '/object/uploads/' + other['id'] + '/forbidden.txt', own['jwt'], 'POST', raw=b'forbidden', headers={'Content-Type': 'text/plain'})
            check(label + ': foreign folder upload denied', status >= 400)
            status, link = http(storage, '/object/sign/uploads/' + path, own['jwt'], 'POST', {'expiresIn': 60})
            check(label + ': own short signing', status == 200 and bool(link.get('signedURL')))
            status, _ = http(storage, '/object/sign/uploads/' + path, other['jwt'], 'POST', {'expiresIn': 60})
            check(label + ': foreign signing denied', status >= 400)
            status, _ = http(storage, '/object/uploads/' + path, other['jwt'])
            check(label + ': foreign download denied', status >= 400)
            status, content = http(storage, link['signedURL'])
            check(label + ': signed private download returns actual bytes', status == 200 and content == b'synthetic private file')
            jwt = urllib.parse.parse_qs(urllib.parse.urlsplit(link['signedURL']).query)['token'][0]
            claims = json.loads(base64.urlsafe_b64decode(jwt.split('.')[1] + '==='))
            check(label + ': signing expires in sixty seconds', claims['exp'] - claims['iat'] == 60)
            tampered = link['signedURL'].replace('token=' + jwt, 'token=' + jwt[:-10] + 'AAAAAAAAAA')
            status, _ = http(storage, tampered)
            check(label + ': invalid private signature rejected', status >= 400)
            status, deleted = http(storage, '/object/uploads', other['jwt'], 'DELETE', {'prefixes': [path]})
            check(label + ': foreign file deletion returns no objects', status == 200 and deleted == [])
            status, content = http(storage, '/object/authenticated/uploads/' + path, own['jwt'])
            check(label + ': denied deletion preserves owner file', status == 200 and content == b'synthetic private file')
            reference='storage://uploads/'+path
            def access(kind, credential=None):
                return {'references':[reference], 'access':{'kind':kind, **({'token':credential} if credential else {})}}
            status, result=http(uploads,'/',own['jwt'],'POST',access('owner'))
            check(label + ': actual Edge returns five-minute owner URL', status==200 and result['expires_in']==300 and bool(result['urls'][0]))
            check(label + ': owner Edge URL uses reachable public gateway', urllib.parse.urlsplit(result['urls'][0]).netloc==urllib.parse.urlsplit(gateway).netloc)
            status, content=http('',result['urls'][0])
            check(label + ': owner Edge signed URL downloads exact private bytes',status==200 and content==b'synthetic private file')
            status, result=http(uploads,'/',other['jwt'],'POST',access('owner'))
            check(label + ': actual Edge refuses another tenant file', status==200 and result['urls']==[None])
            status, _=http(uploads,'/',anon,'POST',access('owner'))
            check(label + ': visitor cannot use owner file access', status==401)
            status, result=http(uploads,'/',anon,'POST',access('brand'))
            check(label + ': private receipt cannot masquerade as public brand', status==200 and result['urls']==[None])
            sql(f"UPDATE contract_installments SET receipt_url='{reference}',receipt_storage_path='{path}' WHERE id='{own['installments'][0]}';")
            status, result=http(uploads,'/',anon,'POST',access('portal',own['portal']))
            check(label + ': valid customer portal signs its receipt', status==200 and bool(result['urls'][0]))
            check(label + ': portal Edge URL uses reachable public gateway', urllib.parse.urlsplit(result['urls'][0]).netloc==urllib.parse.urlsplit(gateway).netloc)
            status, content=http('',result['urls'][0])
            check(label + ': portal Edge signed URL downloads exact private bytes',status==200 and content==b'synthetic private file')
            status, result=http(uploads,'/',anon,'POST',access('portal',other['portal']))
            check(label + ': foreign customer portal cannot sign receipt', status==200 and result['urls']==[None])
            status, result=http(uploads,'/',anon,'POST',access('collector',own['collector_token']))
            check(label + ': assigned collector signs receipt', status==200 and bool(result['urls'][0]))
            status, result=http(uploads,'/',anon,'POST',access('collector',other['collector_token']))
            check(label + ': foreign collector cannot sign receipt', status==200 and result['urls']==[None])
            # Old clients may have persisted the raw Storage path if signing
            # failed. Both forms require the same tenant/session authorization.
            sql(f"UPDATE contract_installments SET receipt_url='{path}' WHERE id='{own['installments'][0]}';")
            raw_access={'references':[path], 'access':{'kind':'portal','token':own['portal']}}
            status, result=http(uploads,'/',anon,'POST',raw_access)
            check(label + ': raw legacy receipt authorizes its customer portal',status==200 and bool(result['urls'][0]))
            status, content=http('',result['urls'][0])
            check(label + ': raw legacy receipt downloads exact private bytes',status==200 and content==b'synthetic private file')
            raw_access['access']['token']=other['portal']
            status, result=http(uploads,'/',anon,'POST',raw_access)
            check(label + ': raw legacy receipt rejects foreign portal',status==200 and result['urls']==[None])
            status, result=http(uploads,'/',other['jwt'],'POST',{'references':[path],'access':{'kind':'owner'}})
            check(label + ': raw legacy receipt rejects foreign owner',status==200 and result['urls']==[None])
            sql(f"UPDATE contract_installments SET receipt_url='{reference}' WHERE id='{own['installments'][0]}';")
            # A readable database row is not proof that the file belongs to
            # that row's owner. Simulate a poisoned URL, without moving files.
            foreign_reference='storage://uploads/'+other['id']+'/fixture.txt'
            sql(f"UPDATE contract_installments SET receipt_url='{foreign_reference}',receipt_storage_path='{other['id']}/fixture.txt' WHERE id='{own['installments'][0]}';")
            status, result=http(uploads,'/',anon,'POST',{'references':[foreign_reference],'access':{'kind':'portal','token':own['portal']}})
            check(label + ': poisoned own portal reference does not expose foreign file',status==200 and result['urls']==[None])
            status, result=http(uploads,'/',own['jwt'],'POST',{'references':[foreign_reference],'access':{'kind':'owner'}})
            check(label + ': poisoned own receipt row cannot authorize foreign file',status==200 and result['urls']==[None])
            sql(f"UPDATE contract_installments SET receipt_url='{reference}',receipt_storage_path='{path}' WHERE id='{own['installments'][0]}';")
            sql(f"UPDATE settings SET company_logo_url='{reference}' WHERE user_id='{own['id']}';")
            status, result=http(uploads,'/',anon,'POST',access('brand'))
            check(label + ': explicitly public own company logo can be read',status==200 and bool(result['urls'][0]))
            status, result=http(uploads,'/',anon,'POST',access('investor',own['investor_token']))
            check(label + ': investor token resolves its company branding',status==200 and bool(result['urls'][0]))
            sql(f"UPDATE settings SET company_logo_url=NULL WHERE user_id='{own['id']}';")
            status, _ = http(rest, '/rpc/pay_installment', own['jwt'], 'POST', {'_installment_id': own['installments'][1], '_paid_total': 40, '_mark_paid': False, '_source_key': 'synthetic-partial-' + label})
            check(label + ': partial of last installment accepted', status == 200)
            status, rows = http(rest, '/contracts?id=eq.' + own['contract'], own['jwt'])
            check(label + ': contract remains active with unpaid debt', status == 200 and rows[0]['status'] == 'active')
            status, _ = http(rest, '/rpc/pay_installment', own['jwt'], 'POST', {'_installment_id': own['installments'][1], '_paid_total': 100, '_mark_paid': True, '_source_key': 'synthetic-complete-last-' + label})
            check(label + ': remaining last installment paid', status == 200)
            status, rows = http(rest, '/contracts?id=eq.' + own['contract'], own['jwt'])
            check(label + ': paying last keeps older partial debt active', status == 200 and rows[0]['status'] == 'active')
            status, _ = http(rest, '/rpc/reverse_installment_payment', own['jwt'], 'POST', {'_installment_id': own['installments'][1]})
            check(label + ': own reversal accepted', status == 200)
            status, rows = http(rest, '/contract_installments?id=eq.' + own['installments'][1], own['jwt'])
            check(label + ': reversal restores zero received', status == 200 and float(rows[0]['paid_amount']) == 0)
            request=str(uuid.uuid4())
            args={'_request_id': request, '_expected_owner': own['id'], '_operation': 'capital_injection',
                  '_amount': 50.25, '_description': 'Comprovante fictício STAGING-001', '_date': '2026-10-08T12:00:00Z'}
            status, first=http(rest, '/rpc/apply_manual_cash_operation', own['jwt'], 'POST', args)
            check(label + ': authenticated human cash entry', status == 200 and first['replayed'] is False)
            status, repeat=http(rest, '/rpc/apply_manual_cash_operation', own['jwt'], 'POST', args)
            check(label + ': lost response does not duplicate cash', status == 200 and repeat['replayed'] is True and repeat['entry_id'] == first['entry_id'])
            status, _=http(rest, '/rpc/apply_manual_cash_operation', other['jwt'], 'POST', args)
            check(label + ': another company cannot use cash request', status == 403)
            check(label + ': human request is durably audited', sql(f"SELECT count(*) FROM manual_cash_operations WHERE user_id='{own['id']}' AND request_id='{request}' AND after_row->>'user_id'='{own['id']}'") == '1')
        # Real overlapping DB sessions: the birthday advisory lock and unique
        # source must prevent both duplicate notification and a second job.
        own = owners[0]
        sql(f"UPDATE settings SET bot_send_birthday=true,whatsapp_instance='synthetic' WHERE user_id='{own['id']}';"
            + "CREATE FUNCTION qa_birthday_pause() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN PERFORM pg_sleep(.3);RETURN NEW;END$$;CREATE TRIGGER qa_pause BEFORE INSERT ON birthday_occurrences FOR EACH ROW EXECUTE FUNCTION qa_birthday_pause();")
        query = f"SELECT enqueue_birthday_greeting('{own['client']}','{own['id']}',(now() AT TIME ZONE 'America/Sao_Paulo')::date);"
        barrier = threading.Barrier(2)
        def enqueue(_):
            barrier.wait(timeout=5)
            return json.loads(sql(query).splitlines()[-1])
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(enqueue, range(2)))
        check('birthday two sessions yield same job', results[0]['job_id'] == results[1]['job_id'])
        check('birthday concurrent creates exactly one', sql("SELECT count(*) FROM whatsapp_scheduled_messages WHERE purpose='birthday'") == '1')
        check('birthday concurrent notification exactly one', sql("SELECT count(*) FROM notifications WHERE type='birthday'") == '1')
        check('birthday manual account awaits approval', all(r['status'] == 'awaiting_approval' for r in results))
        check('no automatic outbox dispatch', sql("SELECT count(*) FROM whatsapp_scheduled_messages WHERE status IN ('pending','sending','sent','uncertain')") == '0')
        # Actual GoTrue recovery, without SMTP or a real mailbox. An expired
        # request changes only the synthetic owner's recovery timestamp.
        own, other=owners
        email='company-a@staging.invalid'
        status, link=http(auth, '/admin/generate_link', service, 'POST', {'type': 'recovery', 'email': email})
        check('recovery link generated for synthetic account', status == 200 and bool(link.get('hashed_token')))
        args={'type': 'recovery', 'token_hash': link['hashed_token']}
        status, recovery=http(auth, '/verify', method='POST', data=args)
        check('recovery token opens correct synthetic user', status == 200 and recovery['user']['id'] == own['id'])
        status, _=http(auth, '/verify', method='POST', data=args)
        check('used recovery token cannot be replayed', status >= 400)
        status, _=http(auth, '/user', recovery['access_token'], 'PUT', {'password': 'x'})
        check('weak recovery password refused', status >= 400)
        password=secrets.token_hex(24)
        status, _=http(auth, '/user', recovery['access_token'], 'PUT', {'password': password})
        check('valid recovery password accepted', status == 200)
        status, _=http(auth, '/token?grant_type=password', method='POST', data={'email': email, 'password': PASSWORD})
        check('old password refused after recovery', status >= 400)
        status, _=http(auth, '/token?grant_type=password', method='POST', data={'email': email, 'password': password})
        check('new password signs into recovered account', status == 200)
        status, user=http(auth, '/user', other['jwt'])
        check('another company session survives recovery', status == 200 and user['id'] == other['id'])
        status, link=http(auth, '/admin/generate_link', service, 'POST', {'type': 'recovery', 'email': email})
        check('next synthetic recovery link generated', status == 200)
        sql(f"UPDATE auth.users SET recovery_sent_at=now()-interval '1 day' WHERE id='{own['id']}';")
        status, _=http(auth, '/verify', method='POST', data={'type': 'recovery', 'token_hash': link['hashed_token']})
        check('expired recovery link refused by actual Auth', status >= 400)
        print(json.dumps({'checks': len(CHECKS), 'passed': CHECKS, 'actualPostgreSQL': True,
                          'actualAuthPasswordLogin': True, 'actualStorageHTTP': True, 'syntheticOwners': 2,
                          'syntheticCollectors': 2,'syntheticInvestors':2,'actualEdgeRuntime':True,'networkInternal': True, 'productionConnections': 0,
                          'realMessages': 0, 'customerDataCopied': 0}))
    except Exception:
        for name in CONTAINERS:
            logs = docker('logs', '--tail', '20', name)
            logs = logs.replace(SECRET, '[redacted]').replace(PASSWORD, '[redacted]')
            logs = re.sub(r'eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+', '[redacted]', logs)
            print(name.rsplit('_', 1)[-1] + ': ' + logs[-1800:])
        raise
    finally:
        for name in reversed(CONTAINERS):
            assert name.startswith(PREFIX + '_')
            docker('stop', '--time', '2', name, timeout=20)
            docker('rm', '-v', name, timeout=20)
        docker('network', 'rm', NETWORK, timeout=20)
        temporary.cleanup()


if __name__ == '__main__':
    main()
