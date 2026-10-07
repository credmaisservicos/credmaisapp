import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useConfirm } from '@/components/ConfirmProvider';
import TemplatesSection from '@/components/configuracoes/sections/TemplatesSection';
import { Button } from '@/components/ui/button';

export default function BotTemplates() {
  const {user}=useAuth(); const {toast}=useToast(); const confirm=useConfirm(); const cache=useQueryClient();
  const [busy,setBusy]=useState(false);
  const [newTemplate,setNewTemplate]=useState({name:'',content:'',trigger_days:''});
  const query=useQuery({queryKey:['message-templates',user?.id],enabled:!!user,
    queryFn:async()=>{const {data,error}=await supabase.from('message_templates').select('*').eq('user_id',user!.id).order('trigger_days');if(error)throw error;return data || [];}});
  const write=async(action:()=>PromiseLike<{error:any}>)=>{
    if(!user || busy)return;setBusy(true);
    try{const {error}=await action();if(error)throw error;await cache.invalidateQueries({queryKey:['message-templates']});toast({title:'Modelos atualizados'});}
    catch{toast({title:'Não foi possível atualizar o modelo',variant:'destructive'});}
    finally{setBusy(false);}
  };
  if(query.isLoading)return <p className="text-sm">Carregando modelos…</p>;
  if(query.isError)return <div role="alert">Não foi possível carregar os modelos. <Button variant="outline" onClick={()=>void query.refetch()}>Tentar novamente</Button></div>;
  return <fieldset disabled={busy}><TemplatesSection ctx={{templates:query.data || [],newTemplate,setNewTemplate,
    inputCls:'w-full min-h-11 rounded-xl border bg-card px-3 py-2 text-sm',notify:title=>toast({title}),
    onAddTemplate:async()=>{
      if(!newTemplate.name.trim() || !newTemplate.content.trim())return;
      await write(()=>supabase.from('message_templates').insert({user_id:user!.id,name:newTemplate.name.trim(),content:newTemplate.content.trim(),trigger_days:newTemplate.trigger_days===''?null:Number(newTemplate.trigger_days),is_active:true}));
    },
    onAddPresetTemplate:async preset=>{await write(()=>supabase.from('message_templates').insert({user_id:user!.id,name:preset.name,content:preset.content,trigger_days:preset.trigger_days,is_active:true}));},
    onDeleteTemplate:async id=>{if(await confirm({title:'Excluir modelo?',description:'As etapas que usam este modelo passarão a usar a mensagem padrão.',confirmLabel:'Excluir',variant:'destructive'}))await write(()=>supabase.from('message_templates').delete().eq('id',id).eq('user_id',user!.id));},
  }}/></fieldset>;
}
