import {it,expect} from 'vitest';
import {financialDay,financialDaysBetween} from '../../supabase/functions/_shared/financial_calendar';
import {computeLateFee,computeLateFeeBreakdown,daysLateOf,interestCapOf,outstandingDue} from '@/lib/lateFee';
import {formatBR,isOverdue,localNoonISO} from '@/lib/dateUtils';
import {generateInstallmentSchedule} from '@/lib/loanMath';

it.each(['2026-10-08T00:00:00Z','2026-10-08T02:59:59Z'])('does not advance a financial day at UTC midnight: %s',timestamp=>{
 const instant=new Date(timestamp);
 expect(financialDay(instant)).toBe('2026-10-07');
 expect(daysLateOf({amount:201,due_date:'2026-10-07'},instant)).toBe(0);
 expect(isOverdue('2026-10-07',instant)).toBe(false);
 expect(computeLateFee({amount:201,due_date:'2026-10-07',daily_interest_percent:.5},instant)).toBe(0);
});
it('starts charges at midnight in Brazil and rounds half a cent like PostgreSQL',()=>{
 const instant=new Date('2026-10-08T03:00:00Z');
 expect(financialDay(instant)).toBe('2026-10-08');expect(financialDaysBetween('2026-10-07',instant)).toBe(1);
 expect(computeLateFee({amount:201,due_date:'2026-10-07',daily_interest_percent:.5},instant)).toBe(1.01);
});
it('interprets a real timestamptz deadline in Brazil, not by its UTC prefix',()=>{
 expect(financialDay('2026-10-08T01:00:00+00:00')).toBe('2026-10-07');
 expect(daysLateOf({amount:100,due_date:'2026-10-08T01:00:00Z'},new Date('2026-10-08T03:00:00Z'))).toBe(1);
});
it('counts calendar days over historical Brazilian daylight-saving transitions',()=>{
 expect(financialDaysBetween('2018-11-03',new Date('2018-11-05T02:30:00Z'))).toBe(2);
 expect(financialDaysBetween('2019-02-16',new Date('2019-02-18T03:30:00Z'))).toBe(2);
});
it.each(['bad','2026-02-30','2026-02-30T15:00:00Z','2026-10-07T25:00:00','31/02/2026'])('rejects an invalid financial day: %s',value=>{
 expect(financialDay(value)).toBeNull();expect(financialDaysBetween(value,'2026-10-08')).toBe(0);
});
it('preserves civil dates in presentation and storage',()=>{
 expect(financialDay('07/10/2026')).toBe('2026-10-07');
 expect(formatBR('2026-10-07')).toContain('07/10/2026');
 expect(localNoonISO('2026-10-07')).toBe('2026-10-07T15:00:00.000Z');
 expect(generateInstallmentSchedule({startDate:'2026-01-31',count:2,frequency:'monthly'})).toEqual(['2026-02-28T15:00:00.000Z','2026-03-31T15:00:00.000Z']);
 expect(generateInstallmentSchedule({startDate:'2026-02-01T01:00:00Z',count:2,frequency:'monthly'})).toEqual(['2026-02-28T15:00:00.000Z','2026-03-31T15:00:00.000Z']);
});
it('keeps the cap, breakdown and partial balance on the same cent rounding',()=>{
 const now=new Date('2026-10-08T03:00:00Z');
 const row={amount:201,due_date:'2026-10-07',daily_interest_percent:-1,daily_penalty_value:.5,max_interest_cap_percent:.5,paid_amount:100.01};
 expect(interestCapOf(row)).toBe(1.01);
 expect(computeLateFeeBreakdown(row,now)).toMatchObject({multa:1.01,juros:0,total:1.01,withFees:202.01});
 expect(outstandingDue(row,now)).toBe(102);
});
it('a missing deadline does not turn into today when a later reference is supplied',()=>{
 expect(financialDaysBetween(undefined,'2099-01-01')).toBe(0);
 expect(computeLateFee({amount:100,due_date:undefined},new Date('2099-01-01T15:00:00Z'))).toBe(0);
});
