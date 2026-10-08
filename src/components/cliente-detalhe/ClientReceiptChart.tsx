import {fmt} from './constants';
export default function ClientReceiptChart({months}:{months:Array<{month:string;label:string;amount:number|null}>}) {
 if(months.some(m=>m.amount==null))return <p className="p-4 text-sm text-muted-foreground">Recebimentos aguardando conferência.</p>;
 const max=Math.max(1,...months.map(m=>m.amount!));
 const points=months.map((m,n)=>`${n*620/Math.max(1,months.length-1)},${160-m.amount!/max*140}`).join(' ');
 return <div className="reference-chart">
  <div className="chart-y">{[1,2/3,1/3,0].map(scale=><span key={scale}>R$ {fmt(max*scale)}</span>)}</div>
  <div className="chart-area"><div className="chart-grid-lines" aria-hidden="true"><i/><i/><i/><i/></div>
   <svg viewBox="0 0 620 170" preserveAspectRatio="none" role="img" aria-label="Recebimentos registrados nos últimos seis meses">
    <title>{months.map(m=>`${m.month}: R$ ${fmt(m.amount!)}`).join('; ')}</title>
    <polyline points={points} fill="none" stroke="hsl(var(--primary))" strokeWidth="2.5" vectorEffect="non-scaling-stroke"/>
   </svg><div className="chart-x">{months.map(m=><span key={m.month}>{m.label.toUpperCase()}</span>)}</div>
  </div>
 </div>;
}
