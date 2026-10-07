import { Link } from 'react-router-dom';
import { Bot, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
export default function AtendimentoSection() {
  return <div className="space-y-4 rounded-xl border bg-card p-5"><Bot className="text-primary" size={24}/><h2 className="text-lg font-semibold">Agente e cobranças em Atendimento</h2><p className="text-sm text-muted-foreground">Conexão do WhatsApp, configurações do agente, régua, modelos de mensagem, conversas e revisões estão no mesmo módulo.</p><Button asChild><Link to="/comunicacao?tab=cobrancas">Configurar agente e cobranças <ArrowRight size={16} className="ml-2"/></Link></Button><Button asChild variant="outline" className="ml-2"><Link to="/comunicacao?tab=bot">Conectar WhatsApp</Link></Button></div>;
}
