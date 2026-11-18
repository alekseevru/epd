import styles from "./page.module.css";

type Month = {month:string;total:number;completed:number};
const count = new Intl.NumberFormat("ru-RU");
const percent = new Intl.NumberFormat("ru-RU",{style:"percent",maximumFractionDigits:1});
const month = new Intl.DateTimeFormat("ru-RU",{month:"short",year:"numeric",timeZone:"UTC"});
const coverage = (row:Month) => row.total ? row.completed/row.total : null;

export function BacklogCharts({months,currentMonth}:{months:Month[];currentMonth:string}) {
  const totals=months.reduce((acc,row)=>({...acc,total:acc.total+row.total,completed:acc.completed+row.completed}),{month:"",total:0,completed:0});
  if (!totals.total) return <p role="status">За выбранный период нет рейсов TMS.</p>;
  const metrics=[
    {name:"Рейсы TMS",note:"Всего рейсов",value:(row:Month)=>row.total,format:count.format,scale:null},
    {name:"Покрытие ЭТрН",note:`${count.format(totals.completed)} с ЭТрН`,value:coverage,format:percent.format,scale:1},
    {name:"Бэклог",note:"Рейсы без ЭТрН",value:(row:Month)=>row.total-row.completed,format:count.format,scale:null},
  ];
  return <>
    <div className={styles.backlogCharts}>{metrics.map((metric,index)=>{
      const max=metric.scale??Math.max(1,...months.map(row=>metric.value(row)??0));
      return <section className={styles.backlogChart} key={metric.name}>
        <h3>{metric.name}</h3>
        <strong className={styles.backlogChartTotal}>{metric.format(metric.value(totals)??0)}</strong>
        <p>{metric.note}</p>
        <ul aria-label={`${metric.name} по месяцам`}>{months.map(row=>{
          const value=metric.value(row),label=month.format(new Date(`${row.month}-01T00:00:00Z`));
          return <li key={row.month}>
            <div className={styles.backlogChartPlot}>
              <div className={styles.backlogChartColumn} style={{height:`${(value??0)/max*100}%`}}>
                <strong>{value===null?"—":metric.format(value)}</strong>
                <span className={index===2?styles.backlogChartOrange:undefined} aria-hidden="true"/>
              </div>
            </div>
            <small>{label}{row.month===currentMonth?"*":""}</small>
          </li>;
        })}</ul>
      </section>;
    })}</div>
    {months.some(row=>row.month===currentMonth)&&<p>* Текущий месяц неполный.</p>}
  </>;
}
