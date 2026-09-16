import { useState } from 'react';
import { Plus, ShieldCheck } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { fetchAll } from '@/lib/fetchAll';
import { useToast } from '@/hooks/use-toast';
import { useCommercial } from '@/hooks/useCommercial';
import { money } from '@/lib/commercial';
import { CollateralDialog, CollateralList } from './Comercial';
import '@/components/commercial/commercial.css';
import '@/components/commercial/commercial-overrides.css';

export default function Garantias() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [showDialog, setShowDialog] = useState(false);
  const { data, isLoading, error, refresh } = useCommercial();
  const { data: clients = [] } = useQuery({
    queryKey: ['commercial-clients', user?.id],
    enabled: !!user,
    queryFn: () => fetchAll((from, to) => supabase.from('clients').select('id,name,full_name,cpf_cnpj').eq('user_id', user!.id).order('name').range(from, to)),
  });
  const reload = async () => {
    await refresh();
    await queryClient.invalidateQueries({ queryKey: ['commercial-clients'] });
  };
  const held = data.collateral.filter((item) => item.status === 'held').length;
  const returned = data.collateral.filter((item) => item.status === 'returned').length;
  const estimated = data.collateral.reduce((sum, item) => {
    const value = Number(item.estimated_value ?? 0);
    return sum + (Number.isFinite(value) ? value : 0);
  }, 0);

  return <main className="commercial-page guarantees-page">
    <section className="commercial-hero"><div><span className="commercial-eyebrow"><ShieldCheck size={15}/> Área independente</span><h1>Garantias sob guarda.</h1><p>Receba, identifique, acompanhe e devolva bens vinculados aos contratos com histórico claro para toda a equipe.</p></div><button className="commercial-primary" onClick={() => setShowDialog(true)}><Plus size={16}/> Nova garantia</button></section>
    <section className="commercial-kpis"><article><span>Em guarda</span><strong>{held}</strong></article><article><span>Devolvidas</span><strong>{returned}</strong></article><article><span>Valor estimado</span><strong>{money(estimated)}</strong></article></section>
    {isLoading ? <div className="commercial-empty"><h2>Carregando garantias…</h2></div> : error ? <div className="commercial-empty"><h2>Não foi possível carregar as garantias</h2><p className="commercial-muted">Aplique a migração comercial antes de usar este módulo.</p></div> : <CollateralList items={data.collateral} onNew={() => setShowDialog(true)} onSaved={reload} />}
    {showDialog && <CollateralDialog clients={clients} onClose={() => setShowDialog(false)} onSaved={reload} />}
  </main>;
}
