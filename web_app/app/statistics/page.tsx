"use client";

import {Fragment,useEffect,useMemo,useState} from "react";
import appPackage from "../../package.json";
import styles from "./page.module.css";

type Audience="carrier"|"consignee";
type Item={
  month:string;carrier:string;consignee:string;title1or2Signed:boolean;
  carrierTitle2Signed:boolean;consigneeTitle3Signed:boolean;
  number:string;containers:string[];deliveryDate:string;
};
type EntityRow={name:string;total:number;signed:number;documents:Item[]};

const currentMonth=()=>new Date().toLocaleDateString("sv-SE",{year:"numeric",month:"2-digit",timeZone:"Europe/Moscow"});
const monthName=(value:string,short=false)=>{const [year,month]=value.split("-").map(Number);return year&&month?new Intl.DateTimeFormat("ru-RU",short?{month:"short"}:{month:"long",year:"numeric"}).format(new Date(year,month-1,1)):value;};

export default function Statistics(){
  const [items,setItems]=useState<Item[]>([]);
  const [loading,setLoading]=useState(true),[error,setError]=useState("");
  const [month,setMonth]=useState(currentMonth),[expanded,setExpanded]=useState<string|null>(null);
  const [rankingMode,setRankingMode]=useState<"best"|"worst">("best"),[audience,setAudience]=useState<Audience>("carrier");
  const load=()=>{setLoading(true);setError("");void fetch("/api/kontur/statistics",{cache:"no-store"}).then(async response=>{const result=await response.json();if(!response.ok)throw new Error(result.error||"Не удалось загрузить статистику");setItems(result.items||[]);}).catch(value=>setError(value instanceof Error?value.message:"Ошибка загрузки")).finally(()=>setLoading(false));};
  useEffect(load,[]);

  const months=useMemo(()=>[...new Set(items.map(item=>item.month).filter(value=>/^\d{4}-\d{2}$/.test(value)))].sort((a,b)=>b.localeCompare(a)),[items]);
  const selected=useMemo(()=>items.filter(item=>item.month===month&&(audience==="carrier"||item.title1or2Signed)),[items,month,audience]);
  const signedFlag=(item:Item)=>audience==="carrier"?item.carrierTitle2Signed:item.consigneeTitle3Signed;
  const totals=useMemo(()=>{const signed=selected.filter(signedFlag).length;return {total:selected.length,signed,unsigned:selected.length-signed};},[selected,audience]);
  const circumference=2*Math.PI*46,signedPercent=totals.total?Math.round(totals.signed/totals.total*100):0;
  const entities=useMemo(()=>{const result=new Map<string,EntityRow>();for(const item of selected){const name=(audience==="carrier"?item.carrier:item.consignee)||"Не указано",row=result.get(name)||{name,total:0,signed:0,documents:[]};row.total++;row.documents.push(item);if(signedFlag(item))row.signed++;result.set(name,row);}return [...result.values()].sort((a,b)=>b.total-a.total||a.name.localeCompare(b.name,"ru"));},[selected,audience]);
  const ranked=useMemo(()=>entities.filter(row=>row.name!=="Не указано").map(row=>({...row,percent:Math.round(row.signed/row.total*100)})).sort((a,b)=>rankingMode==="best"?b.percent-a.percent||b.total-a.total:a.percent-b.percent||b.total-a.total).slice(0,5),[entities,rankingMode]);
  const rankingPercent=ranked.length?Math.round(ranked.reduce((sum,row)=>sum+row.percent,0)/ranked.length):0;
  const titleNumber=audience==="carrier"?2:3,entityLabel=audience==="carrier"?"Перевозчик":"Грузополучатель";

  return <main className={styles.shell}>
    <header className={styles.topbar}><div>А</div><strong>Создание ЭПД <small>версия {appPackage.version}</small></strong><nav><a href="/workspace">Создание документов</a><a href="/forwarding-orders">Поручения клиентам</a><a href="/control">Контроль подписания</a><a className={styles.active} href="/statistics">Статистика</a><a href="/edo-settings">Настройки ID ЭДО</a></nav></header>
    <section className={styles.content}>
      <header className={styles.heading}><div><small>АНАЛИТИКА ЭТрН</small><h1>Статистика ЭТрН</h1><p>{audience==="carrier"?"Контроль подписания титула 2 перевозчиками.":"Контроль подписания титула 3 грузополучателями после наступления даты доставки."}</p></div><button onClick={load} disabled={loading}>{loading?"Считаем…":"Обновить"}</button></header>
      {error&&<p className={styles.error}>{error}</p>}
      <section className={styles.audienceSwitch}><button className={audience==="carrier"?styles.on:""} onClick={()=>{setAudience("carrier");setExpanded(null)}}>Перевозчики · титул 2</button><button className={audience==="consignee"?styles.on:""} onClick={()=>{setAudience("consignee");setExpanded(null)}}>Грузополучатели · титул 3</button></section>
      <section className={styles.monthFilter}><label><span>Отчётный месяц</span><select value={month} onChange={event=>setMonth(event.target.value)}><option value={currentMonth()}>{monthName(currentMonth())}{months.includes(currentMonth())?"":" · нет данных"}</option>{months.filter(value=>value!==currentMonth()).map(value=><option value={value} key={value}>{monthName(value)}</option>)}</select></label></section>
      <section className={styles.metrics}>{[{name:"ЭТрН в контроле",value:totals.total},{name:`Подписано Т${titleNumber}`,value:totals.signed},{name:audience==="carrier"?"Не подписано Т2":"Отклонения · нет Т3",value:totals.unsigned}].map(card=><article key={card.name}><span>{card.name}</span><strong>{card.value}</strong></article>)}</section>
      <section className={styles.charts}>
        <article className={`${styles.chartCard} ${styles.monthTotalCard}`}><header><div><small>ОБЪЁМ</small><h2>ЭТрН за {monthName(month)}</h2></div></header><div className={styles.singleBar}><strong>{totals.total}</strong><span><i style={{height:totals.total?"100%":"0"}}/></span><small>{monthName(month,true)}</small></div></article>
        <article className={`${styles.chartCard} ${styles.rankingCard}`}><header><div><small>РЕЙТИНГ</small><h2>{entityLabel} · титул {titleNumber}</h2></div><div className={styles.rankSwitch}><button className={rankingMode==="best"?styles.on:""} onClick={()=>setRankingMode("best")}>Топ‑5 лучших</button><button className={rankingMode==="worst"?styles.on:""} onClick={()=>setRankingMode("worst")}>Топ‑5 худших</button></div></header><div className={styles.rankBody}><div className={styles.miniDonut}><svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="46"/><circle className={styles.donutValue} cx="60" cy="60" r="46" strokeDasharray={circumference} strokeDashoffset={circumference*(1-rankingPercent/100)}/></svg><div><strong>{rankingPercent}%</strong><span>среднее</span></div></div><ol>{ranked.map(row=><li key={row.name}><span title={row.name}>{row.name}</span><strong>{row.percent}%</strong></li>)}{!ranked.length&&<li>Нет данных</li>}</ol></div></article>
        <article className={styles.chartCard}><header><div><small>ПОДПИСАНИЕ</small><h2>Доля подписанных · титул {titleNumber}</h2></div></header><div className={styles.donutWrap}><svg className={styles.donut} viewBox="0 0 120 120"><circle cx="60" cy="60" r="46"/><circle className={styles.donutValue} cx="60" cy="60" r="46" strokeDasharray={circumference} strokeDashoffset={circumference*(1-signedPercent/100)}/></svg><div className={styles.donutLabel}><strong>{signedPercent}%</strong><span>подписано</span></div></div><div className={styles.legend}><div><i className={styles.green}/><span>Подписано Т{titleNumber}</span><strong>{totals.signed}</strong></div><div><i className={styles.red}/><span>{audience==="carrier"?"Не подписано":"Отклонение"}</span><strong>{totals.unsigned}</strong></div></div></article>
      </section>
      <section className={styles.carrierSection}><header><div><small>{audience==="carrier"?"ПЕРЕВОЗЧИКИ":"ГРУЗОПОЛУЧАТЕЛИ"}</small><h2>Подписание титула {titleNumber} за {monthName(month)}</h2><p>{audience==="carrier"?"Учтены только ЭТрН с уже наступившей плановой датой доставки.":"Отклонение — Т1 или Т2 подписан, дата доставки наступила, но Т3 не подписан."} Нажмите на строку для проверки документов.</p></div><span>{entities.length} {audience==="carrier"?"перевозчиков":"грузополучателей"}</span></header>
        <div className={styles.tableWrap}><table><thead><tr><th>{entityLabel}</th><th>ЭТрН</th><th>Подписано Т{titleNumber}</th><th>Процент подписания</th></tr></thead><tbody>
          {entities.map(row=>{const percent=row.total?Math.round(row.signed/row.total*100):0,isOpen=expanded===row.name;return <Fragment key={row.name}><tr className={styles.carrierRow} onClick={()=>setExpanded(isOpen?null:row.name)} aria-expanded={isOpen}><td><button type="button" className={styles.expandButton}><span>{isOpen?"−":"+"}</span><strong>{row.name}</strong></button></td><td>{row.total}</td><td>{row.signed}</td><td><div className={styles.percentCell}><strong>{percent}%</strong><span><i style={{width:`${percent}%`}}/></span></div></td></tr>{isOpen&&<tr className={styles.detailsRow}><td colSpan={4}><div className={styles.documentList}><div className={styles.documentHead}><span>ЭТрН</span><span>Контейнеры</span><span>Дата доставки</span><span>Титул {titleNumber}</span></div>{row.documents.map((item,index)=><div className={styles.documentItem} key={`${item.number}-${index}`}><strong>{item.number}</strong><span>{item.containers?.length?item.containers.join(", "):"—"}</span><span>{item.deliveryDate||"—"}</span><span className={signedFlag(item)?styles.signed:styles.unsigned}>{signedFlag(item)?"Подписан":audience==="consignee"?"Отклонение":"Не подписан"}</span></div>)}</div></td></tr>}</Fragment>})}
          {!loading&&!entities.length&&<tr><td colSpan={4} className={styles.empty}>За выбранный месяц данных нет</td></tr>}
        </tbody></table></div>
      </section>
    </section>
  </main>;
}
