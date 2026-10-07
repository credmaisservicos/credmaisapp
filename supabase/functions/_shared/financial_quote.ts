import {financialDaysBetween} from './financial_calendar.ts';

interface DecimalValue{
 plus(value:number|string):DecimalValue;minus(value:number|string):DecimalValue;
 times(value:number|string):DecimalValue;div(value:number|string):DecimalValue;
 pow(value:number):DecimalValue;toDecimalPlaces(places:number,rounding:number):DecimalValue;
 comparedTo(value:number|string):number;toNumber():number;toString():string;
}
export type DecimalConstructor=new(value:number|string)=>DecimalValue;
export interface FinancialChargeInput{
 amount?:unknown;due_date?:string|null;status?:string|null;late_fee?:unknown;
 daily_interest_percent?:unknown;daily_penalty_type?:unknown;daily_penalty_value?:unknown;
 max_interest_cap_percent?:unknown;frozen?:boolean;
}
const nonnegative=(value:unknown)=>Number.isFinite(Number(value))?Math.max(0,Number(value)):0;

/** Same compound charge, daily penalty, cap and stored floor as the payment RPC. */
export function financialLateFee(input:FinancialChargeInput,Decimal:DecimalConstructor,reference:string|Date=new Date()):number{
 const stored=nonnegative(input.late_fee);
 if(['paid','cancelled'].includes(input.status||'')||input.frozen)return stored;
 const days=Math.max(0,financialDaysBetween(input.due_date,reference)),base=nonnegative(input.amount);
 if(!base||!days)return stored;
 const configured=Number(input.daily_interest_percent)||4,rate=Number.isFinite(configured)?Math.max(0,configured):4;
 const penalty=nonnegative(input.daily_penalty_value);
 const interest=new Decimal(1).plus(new Decimal(rate).div(100).toString()).pow(days).minus(1).times(base);
 const dailyPenalty=input.daily_penalty_type==='fixed'?new Decimal(penalty).times(days):new Decimal(base).times(penalty).div(100).times(days);
 let fee=interest.plus(dailyPenalty.toString()).toDecimalPlaces(2,4);
 const cap=nonnegative(input.max_interest_cap_percent);
 if(cap>0){const ceiling=new Decimal(base).times(cap).div(100).toDecimalPlaces(2,4);if(fee.comparedTo(ceiling.toString())>0)fee=ceiling;}
 const result=Math.max(stored,fee.toNumber());
 if(!Number.isFinite(result)||!Number.isSafeInteger(Math.round(result*100)))throw Error('financial_charge_unavailable');
 return result;
}
