import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Clock, Plus, Save, ShieldCheck, Trash2, Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { BOT_DEFAULTS, loadBotSettings, validateBotSettings, botSettingsChanges, type BotSettingsForm } from '@/lib/botSettings';
import BotTemplates from './BotTemplates';

const DAYS=[['mon','Seg'],['tue','Ter'],['wed','Qua'],['thu','Qui'],['fri','Sex'],['sat','Sáb'],['sun','Dom']];
export default function BotSettings() {
  const {user}=useAuth(); const {toast}=useToast(); const cache=useQueryClient();
  const [form,setForm]=useState<BotSettingsForm>(BOT_DEFAULTS);
  const [dirty,setDirty]=useState(false); const [saving,setSaving]=useState(false);
  const settings=useQuery({queryKey:['bot-settings',user?.id],enabled:!!user,refetchOnWindowFocus:false,staleTime:0,refetchOnMount:'always',retry:false,
    queryFn:async()=>{const {data,error}=await supabase.from('settings_safe').select('*').eq('user_id',user!.id).single();if(error)throw error;return data;}});
  useEffect(()=>{if(settings.data && !dirty)setForm(loadBotSettings(settings.data));},[settings.data,dirty]);
  const change=<K extends keyof BotSettingsForm>(key:K,value:BotSettingsForm[K])=>{setDirty(true);setForm(p=>({...p,[key]:value}));};
  const save=async()=>{
    if(!user || !settings.data || saving)return;
    const invalid=validateBotSettings(form);if(invalid){toast({title:'Revise as configurações',description:invalid,variant:'destructive'});return;}
    setSaving(true);
    try {
      const updates=botSettingsChanges(form,loadBotSettings(settings.data));
      if(Object.keys(updates).length){const {data,error}=await supabase.from('settings').update(updates).eq('user_id',user.id).select('id').single();if(error || !data)throw error || Error('Configuração indisponível.');}
      cache.setQueryData(['bot-settings',user.id],{...settings.data,...updates});
      void cache.invalidateQueries({queryKey:['bot-settings',user.id]});
      setDirty(false);
      for(const key of ['settings','settings-agent','central-bot-settings','central-bot-health'])void cache.invalidateQueries({queryKey:[key]});
      toast({title:'Agente e cobranças atualizados'});
    }catch{toast({title:'Não foi possível salvar',description:'Suas alterações continuam aqui. Tente novamente.',variant:'destructive'});}
    finally{setSaving(false);}
  };
  const toggle=(key:keyof BotSettingsForm,label:string,description:string)=><div className="flex items-center justify-between gap-4 py-3"><div className="min-w-0"><Label htmlFor={key}>{label}</Label><p className="mt-1 text-xs text-muted-foreground">{description}</p></div><Switch id={key} checked={!!form[key]} onCheckedChange={v=>change(key,v as never)} /></div>;
  if(settings.isLoading)return <p className="flex items-center gap-2 p-6"><Loader2 size={16} className="animate-spin"/>Carregando configurações…</p>;
  if(settings.isError || !settings.data)return <div role="alert" className="rounded-xl border p-5">Não foi possível carregar as configurações. <Button variant="outline" onClick={()=>void settings.refetch()}>Tentar novamente</Button></div>;
  return <div className="space-y-5 min-w-0">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-bold">Agente e cobranças</h2><p className="text-sm text-muted-foreground">Defina como atender, quando cobrar e o que precisa da sua aprovação.</p></div><Button onClick={()=>void save()} disabled={saving || !dirty}><Save size={16} className="mr-2"/>{saving?'Salvando…':'Salvar alterações'}</Button></div>
    <fieldset disabled={saving} className="space-y-5 min-w-0">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5"><h3 className="flex gap-2 font-semibold"><Bot size={18}/>Atendimento</h3>
          {toggle('bot_enabled','Ativar agente','Habilita o atendimento e a régua de cobranças.')}
          {toggle('bot_use_ai','Personalizar com IA','Sem integração disponível, o agente usa mensagens e regras locais.')}
          <Label htmlFor="bot-tone">Tom das mensagens</Label><select id="bot-tone" value={form.bot_tone} onChange={e=>change('bot_tone',e.target.value)} className="mt-2 min-h-11 w-full rounded-lg border bg-card px-3 text-sm">{[...new Set(['formal','amigavel','urgente',form.bot_tone])].map(t=><option key={t} value={t}>{({formal:'Formal',amigavel:'Amigável',urgente:'Direto e respeitoso'} as Record<string,string>)[t] || t}</option>)}</select>
        </Card>
        <Card className="p-5"><h3 className="flex gap-2 font-semibold"><ShieldCheck size={18}/>Envio e conferência</h3>
          {toggle('bot_auto_send','Enviar automaticamente','Desativado: respostas e cobranças aguardam aprovação na conversa.')}
          {toggle('bot_process_audio','Entender áudios','Depende da integração de transcrição; os arquivos ficam no atendimento.')}
          {toggle('bot_process_receipts','Receber comprovantes para revisão','A equipe confere o recebimento antes de confirmar o pagamento.')}
          <p className="rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">Descontos e mudanças de prazo são avaliados pela equipe. Comprovantes exigem confirmação humana.</p>
        </Card>
      </div>
      <Card className="p-5 space-y-4"><h3 className="flex gap-2 font-semibold"><Clock size={18}/>Agenda e limites</h3>
        <div className="grid gap-4 sm:grid-cols-3"><div><Label htmlFor="collection-time">Horário da cobrança</Label><Input id="collection-time" type="time" value={`${String(form.bot_send_hour).padStart(2,'0')}:${String(form.bot_send_minute).padStart(2,'0')}`} onChange={e=>{const [h,m]=e.target.value.split(':').map(Number);setDirty(true);setForm(p=>({...p,bot_send_hour:h,bot_send_minute:m}));}}/><p className="mt-1 text-xs text-muted-foreground">Horário de Brasília.</p></div><div><Label htmlFor="collection-limit">Limite diário</Label><Input id="collection-limit" type="number" min={1} max={500} value={form.bot_max_messages_per_day} onChange={e=>change('bot_max_messages_per_day',Number(e.target.value))}/></div><div><Label htmlFor="collection-interval">Intervalo entre cobranças (h)</Label><Input id="collection-interval" type="number" min={1} max={168} value={form.bot_retry_interval_hours} onChange={e=>change('bot_retry_interval_hours',Number(e.target.value))}/></div></div>
        <div className="flex flex-wrap gap-2" aria-label="Dias de funcionamento">{DAYS.map(([day,label])=><Button key={day} type="button" variant={form.bot_work_days.includes(day)?'default':'outline'} aria-pressed={form.bot_work_days.includes(day)} onClick={()=>change('bot_work_days',form.bot_work_days.includes(day)?form.bot_work_days.filter(d=>d!==day):[...form.bot_work_days,day])}>{label}</Button>)}</div>
        {toggle('bot_business_hours_only','Restringir ao expediente','Envios automáticos aguardam o expediente. Atendimento humano continua disponível.')}
        {form.bot_business_hours_only && <div className="grid gap-4 sm:grid-cols-2">{(['bot_business_start','bot_business_end'] as const).map((key,i)=><div key={key}><Label htmlFor={key}>{i?'Fim do expediente':'Início do expediente'}</Label><Input id={key} type="time" value={form[key]} onChange={e=>change(key,e.target.value)}/></div>)}</div>}
      </Card>
      <Card className="p-5 space-y-4"><div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">Régua de cobranças</h3><Button type="button" variant="outline" onClick={()=>change('bot_escalation_rules',[...form.bot_escalation_rules,{days:0,template:'',channel:'whatsapp'}])}><Plus size={16} className="mr-2"/>Adicionar etapa</Button></div><p className="text-xs text-muted-foreground">Dias negativos lembram antes do vencimento, zero lembra no dia e dias positivos cobram o atraso. Parcelas futuras ficam fora da cobrança de atraso.</p>
        {!form.bot_escalation_rules.length && <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Nenhuma etapa cadastrada. O agente pode atender; cobranças automáticas precisam de uma régua.</p>}
        {form.bot_escalation_rules.map((rule,i)=><div key={i} className="grid gap-3 rounded-xl border p-3 sm:grid-cols-[100px_1fr_150px_auto]">{[['days','Dias'],['template','Nome do modelo']] .map(([key,label])=><div key={key}><Label htmlFor={`rule-${key}-${i}`}>{label}</Label><Input id={`rule-${key}-${i}`} type={key==='days'?'number':'text'} min={-30} max={365} value={rule[key as 'days'|'template']} placeholder={key==='template'?'Mensagem padrão':''} onChange={e=>change('bot_escalation_rules',form.bot_escalation_rules.map((r,j)=>j===i?{...r,[key]:key==='days'?Number(e.target.value):e.target.value}:r))}/></div>)}<div><Label htmlFor={`rule-channel-${i}`}>Canal</Label><select id={`rule-channel-${i}`} className="min-h-10 w-full rounded-md border bg-card px-2 text-sm" value={rule.channel} onChange={e=>change('bot_escalation_rules',form.bot_escalation_rules.map((r,j)=>j===i?{...r,channel:e.target.value}:r))}><option value="whatsapp">WhatsApp</option><option value="email">E-mail</option><option value="both">Ambos</option>{!['whatsapp','email','both'].includes(rule.channel)&&<option value={rule.channel}>Canal indisponível: {rule.channel}</option>}</select></div><Button type="button" variant="ghost" className="self-end" aria-label={`Remover etapa ${i+1}`} onClick={()=>change('bot_escalation_rules',form.bot_escalation_rules.filter((_,j)=>j!==i))}><Trash2 size={16}/></Button></div>)}
      </Card>
      <details className="rounded-xl border bg-card p-5"><summary className="cursor-pointer font-semibold">Mensagens e acompanhamento</summary><div className="pt-4 space-y-4">{(['bot_greeting_message','bot_closing_message'] as const).map((key,i)=><div key={key}><Label htmlFor={key}>{i?'Encerramento':'Saudação'}</Label><Textarea id={key} value={form[key]} onChange={e=>change(key,e.target.value)} placeholder="Use {nome}, {empresa}, {valor} ou {dias}."/></div>)}{toggle('bot_stop_on_payment','Parar ao detectar pagamento','Interrompe a sequência após um recebimento registrado, inclusive parcial.')}{toggle('bot_send_pix','Incluir PIX','Usa a chave cadastrada em Configurações → Dados de cobrança.')}{toggle('bot_send_receipt','Enviar confirmação de pagamento','Confirma o valor de cada recebimento registrado, inclusive parcial. No modo manual, aguarda aprovação na fila.')}{toggle('bot_notify_owner','Notificar responsável','Avisa sobre cobranças na fila, em revisão e aceitas pelo provedor.')}</div></details>
      <Button onClick={()=>void save()} disabled={saving || !dirty} className="w-full sm:w-auto"><Save size={16} className="mr-2"/>{saving?'Salvando…':'Salvar alterações'}</Button>
    </fieldset>
    <details className="rounded-xl border bg-card p-5"><summary className="cursor-pointer font-semibold">Modelos de mensagem</summary><div className="pt-5"><BotTemplates/></div></details>
  </div>;
}
