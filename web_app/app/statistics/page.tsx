"use client";

import {useEffect,useMemo,useState} from "react";
import appPackage from "../../package.json";
import styles from "./page.module.css";

type Item={month:string;carrier:string;carrierTitle2Signed:boolean};
const currentMonth=()=>new Date().toLocaleDateString("sv-SE",{year:"numeric",month:"2-digit",timeZone:"Europe/Moscow"});
const monthName=(value:string,short=false)=>{const [year,month]=value.split("-").map(Number);return year&&month?new Intl.DateTimeFormat("ru-RU",short?{month:"short"}:{month:"long",year:"numeric"}).format(new Date(year,month-1,1)):value;};

export default function Statistics(){
  const [items,setItems]=useState<Item[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState(""),[month,setMonth]=useState(currentMonth);
  const load=()=>{setLoading(true);setError("");void fetch("/api/kontur/statistics",{cache:"no-store"}).then(async response=>{const result=await response.json();if(!response.ok)throw new Error(result.error||"Не удалось загрузить статистику");setItems(result.items||[]);}).catch(value=>setError(value instanceof Error?value.message:"Ошибка загрузки")).finally(()=>setLoading(false));};
  useEffect(load,[]);
  const months=useMemo(()=>[...new Set(items.map(item=>item.month).filter(value=>/^\d{4}-\d{2}$/.test(value)))].sort((a,b)=>b.localeCompare(a)),[items]);
  const selected=useMemo(()=>items.filter(item=>item.month===month),[items,month]);
  const totals=useMemo(()=>{const signed=selected.filter(item=>item.carrierTitle2Signed).length;return {total:selected.length,signed,unsigned:selected.length-signed};},[selected]);
  const monthly=useMemo(()=>{const result=new Map<string,number>();for(const item of items)result.set(item.month,(result.get(item.month)||0)+1);return [...result.entries()].filter(([key])=>/^\d{4}-\d{2}$/.test(key)).sort(([a],[b])=>a.localeCompare(b)).map(([key,total])=>({month:key,total}));},[items]);
  const chartMax=Math.max(1,...monthly.map(row=>row.total)),signedPercent=totals.total?Math.round(totals.signed/totals.total*100):0,circumference=2*Math.PI*46;
  const carriers=useMemo(()=>{const result=new Map<string,{name:string;total:number;signed:number}>();for(const item of selected){const name=item.carrier||"Не указано",row=result.get(name)||{name,total:0,signed:0};row.total++;if(item.carrierTitle2Signed)row.signed++;result.set(name,row);}return [...result.values()].sort((a,b)=>b.total-a.total||a.name.localeCompare(b.name,"ru"));},[selected]);
  return <main className={styles.shell}>
    <header className={styles.topbar}><div>А</div><strong>Создание ЭПД <small>версия {appPackage.version}</small></strong><nav><a href="/workspace">Создание документов</a><a href="/forwarding-orders">Поручения клиентам</a><a href="/control">Контроль подписания</a><a className={styles.active} href="/statistics">Статистика</a><a href="/edo-settings">Настройки ID ЭДО</a></nav></header>
    <section className={styles.content}>
      <header className={styles.heading}><div><small>АНАЛИТИКА ЭТрН</small><h1>Статистика ЭТрН</h1><p>Контроль подписания титула 2 перевозчиками.</p></div><button onClick={load} disabled={loading}>{loading?"Считаем…":"Обновить"}</button></header>
      {error&&<p className={styles.error}>{error}</p>}
      <section className={styles.monthFilter}><label><span>Отчётный месяц</span><select value={month} onChange={event=>setMonth(event.target.value)}><option value={currentMonth()}>{monthName(currentMonth())}{months.includes(currentMonth())?"":" · нет данных"}</option>{months.filter(value=>value!==currentMonth()).map(value=><option value={value} key={value}>{monthName(value)}</option>)}</select></label></section>
      <section className={styles.metrics}>{[{name:"ЭТрН за месяц",value:totals.total},{name:"Подписано Т2",value:totals.signed},{name:"Не подписано Т2",value:totals.unsigned}].map(card=><article key={card.name}><span>{card.name}</span><strong>{card.value}</strong></article>)}</section>
      <section className={styles.charts}>
        <article className={`${styles.chartCard} ${styles.compactChart}`}><header><div><small>ДИНАМИКА</small><h2>Общее количество ЭТрН по месяцам</h2></div></header><div className={styles.barChart}>{monthly.map(row=><button type="button" className={`${styles.barColumn} ${row.month===month?styles.selectedBar:""}`} key={row.month} onClick={()=>setMonth(row.month)} title={`${monthName(row.month)}: ${row.total}`}><strong>{row.total}</strong><span className={styles.barTrack}><i className={styles.bar} style={{height:`${Math.max(row.total?7:0,row.total/chartMax*100)}%`}}/></span><small>{monthName(row.month,true)}</small></button>)}{!monthly.length&&<p className={styles.chartEmpty}>Нет данных</p>}</div></article>
        <article className={styles.chartCard}><header><div><small>ПОДПИСАНИЕ</small><h2>Доля подписанных · титул 2</h2></div></header><div className={styles.donutWrap}><svg className={styles.donut} viewBox="0 0 120 120"><circle cx="60" cy="60" r="46"/><circle className={styles.donutValue} cx="60" cy="60" r="46" strokeDasharray={circumference} strokeDashoffset={circumference*(1-signedPercent/100)}/></svg><div className={styles.donutLabel}><strong>{signedPercent}%</strong><span>подписано</span></div></div><div className={styles.legend}><div><i className={styles.green}/><span>Подписано Т2</span><strong>{totals.signed}</strong></div><div><i className={styles.red}/><span>Не подписано</span><strong>{totals.unsigned}</strong></div></div></article>
      </section>
      <section className={styles.carrierSection}><header><div><small>ПЕРЕВОЗЧИКИ</small><h2>Подписание титула 2 за {monthName(month)}</h2></div><span>{carriers.length} перевозчиков</span></header><div className={styles.tableWrap}><table><thead><tr><th>Перевозчик</th><th>ЭТрН</th><th>Подписано Т2</th><th>Процент подписания</th></tr></thead><tbody>{carriers.map(row=>{const percent=row.total?Math.round(row.signed/row.total*100):0;return <tr key={row.name}><td><strong>{row.name}</strong></td><td>{row.total}</td><td>{row.signed}</td><td><div className={styles.percentCell}><strong>{percent}%</strong><span><i style={{width:`${percent}%`}}/></span></div></td></tr>})}{!loading&&!carriers.length&&<tr><td colSpan={4} className={styles.empty}>За выбранный месяц данных нет</td></tr>}</tbody></table></div></section>
    </section>
  </main>;
}
