import {useEffect,useState} from 'react';
export function useFinancialClock(){const [now,setNow]=useState(()=>new Date());useEffect(()=>{const id=setInterval(()=>setNow(new Date()),60_000);return()=>clearInterval(id);},[]);return now;}
