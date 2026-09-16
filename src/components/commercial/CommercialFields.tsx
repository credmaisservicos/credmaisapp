import { useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import type { CollateralInput } from '@/lib/commercial';
import { toast } from 'sonner';

export function Field({ label, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return <label className="commercial-field"><span>{label}</span><input aria-label={props["aria-label"] ?? label} {...props} /></label>;
}
export function SelectField({label,value,onChange,children,required=false}:{label:string;value:string;onChange:(value:string)=>void;children:ReactNode;required?:boolean}) {
  return <label className="commercial-field"><span>{label}</span><select aria-label={label} value={value} onChange={e=>onChange(e.target.value)} required={required}>{children}</select></label>;
}
export function Photos({value,onChange}:{value:string[];onChange:(photos:string[])=>void}) {
  const {user}=useAuth();const [busy,setBusy]=useState(false);
  return <div className="commercial-photos"><label className="commercial-field"><span>Fotos do bem · até 6 arquivos de 5 MB</span><input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy||value.length>=6} onChange={async e=>{
    const file=e.target.files?.[0];e.target.value='';if(!file||!user)return;
    if(file.size>5*1024*1024||!['image/jpeg','image/png','image/webp'].includes(file.type)){toast.error('Envie uma imagem JPG, PNG ou WebP de até 5 MB');return;}
    setBusy(true);try {const path=`${user.id}/commercial/${crypto.randomUUID()}.${file.type.split('/')[1]}`;const {error}=await supabase.storage.from('uploads').upload(path,file);if(error)throw error;onChange([...value,path]);}catch(error){toast.error((error as Error).message);}finally{setBusy(false);}
  }}/></label>{busy&&<p role="status">Enviando foto…</p>}<div className="flex flex-wrap gap-2">{value.map((path,index)=><div key={path} className="flex gap-1"><button type="button" className="commercial-secondary" onClick={async()=>{const {data,error}=await supabase.storage.from('uploads').createSignedUrl(path,120);if(error){toast.error(error.message);return;}window.open(data.signedUrl,'_blank','noopener,noreferrer');}}>Foto {index+1}</button><button type="button" aria-label={`Remover foto ${index+1}`} className="commercial-secondary" onClick={()=>onChange(value.filter(p=>p!==path))}>×</button></div>)}</div></div>;
}
export function CollateralFields({value,onChange}:{value:CollateralInput;onChange:(value:CollateralInput)=>void}) {
  const set=(key:keyof CollateralInput,v:unknown)=>onChange({...value,[key]:v});
  return <div className="commercial-form-grid"><Field label="Descrição do bem" required minLength={3} maxLength={500} value={value.description} onChange={e=>set('description',e.target.value)}/><SelectField label="Categoria" value={value.category} onChange={v=>set('category',v)}>{['Celular','Veículo','Joia','Eletrônico','Outro'].map(v=><option key={v}>{v}</option>)}</SelectField><Field label="IMEI, placa ou número de série" value={value.identifier} onChange={e=>set('identifier',e.target.value)}/><Field label="Valor estimado (R$)" required type="number" min="0.01" step="0.01" value={value.estimated_value||''} onChange={e=>set('estimated_value',Number(e.target.value))}/><Field label="Estado de conservação" value={value.condition} onChange={e=>set('condition',e.target.value)}/><Field label="Local de guarda" value={value.storage_location} onChange={e=>set('storage_location',e.target.value)}/><Field label="Observações do recebimento" value={value.notes} onChange={e=>set('notes',e.target.value)}/><Photos value={value.photos} onChange={v=>set('photos',v)}/></div>;
}
