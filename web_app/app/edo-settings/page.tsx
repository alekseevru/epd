"use client";
import {useEffect,useMemo,useState} from "react";
import baseStyles from "./edo-settings.module.css";
import tableStyles from "./edo-table.module.css";
import appPackage from "../../package.json";

type History={count:number;lastSignedAt:string;documentNumber:string};
type Option={id:string;operator:string;boxId:string;history:History|null};
type Party={name:string;inn:string;kpp:string;key:string;selectedId:string;selectionSource:"manual"|"history"|"automatic"|"unresolved";selectedBy:string;selectedAt:string;options:Option[]};
const styles={...baseStyles,...tableStyles};

const selectedOption=(party:Party)=>party.options.find(option=>option.id===party.selectedId);
const confirmedParties=(parties:Party[])=>parties.flatMap(party=>{
  const option=selectedOption(party);
  return option?.history && option.history.count>0 ? [{party,option,history:option.history}] : [];
});

export default function EdoSettings(){
  const [parties,setParties]=useState<Party[]>([]),[loading,setLoading]=useState(true),[query,setQuery]=useState(""),[message,setMessage]=useState("Ищем контрагентов с несколькими операторами…");
  const [drafts,setDrafts]=useState<Record<string,string>>({}),[saving,setSaving]=useState(""),[expanded,setExpanded]=useState<Record<string,boolean>>({}),[exporting,setExporting]=useState(false);
  const load=async()=>{setLoading(true);try{const response=await fetch("/api/edo-directory",{cache:"no-store"});const result=await response.json();if(!response.ok)throw new Error(result.error);setParties(result.parties||[]);setMessage(`Контрагентов с несколькими операторами: ${(result.parties||[]).length}`);}catch(error){setMessage(error instanceof Error?error.message:"Не удалось загрузить справочник");}finally{setLoading(false);}};
  useEffect(()=>{void load();},[]);
  const filtered=useMemo(()=>{const value=query.trim().toLocaleLowerCase("ru-RU");return !value?parties:parties.filter(party=>[party.name,party.inn,party.kpp,...party.options.flatMap(option=>[option.operator,option.id])].some(item=>String(item||"").toLocaleLowerCase("ru-RU").includes(value)));},[parties,query]);
  const confirmed=useMemo(()=>confirmedParties(parties),[parties]);
  const save=async(party:Party)=>{const participantId=drafts[party.key]||party.selectedId;if(!participantId)return;setSaving(party.key);try{const response=await fetch("/api/edo-preference",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({key:party.key,participantId,selectedBy:"Справочник настроек"})});const result=await response.json();if(!response.ok)throw new Error(result.error);setParties(current=>current.map(item=>item.key===party.key?{...item,selectedId:participantId,selectionSource:"manual",selectedBy:"Справочник настроек",selectedAt:result.preference.selectedAt}:item));setDrafts(current=>{const next={...current};delete next[party.key];return next;});setMessage(`Выбор для ${party.name} сохранён отдельно и не изменится при обновлении справочников.`);}catch(error){setMessage(error instanceof Error?error.message:"Не удалось сохранить выбор");}finally{setSaving("");}};
  const exportExcel=async()=>{if(!confirmed.length)return;setExporting(true);try{
    const XLSX=await import("xlsx");
    const rows=[["Название организации","ИНН","КПП","Оператор ЭДО","Идентификатор участника ЭДО","Подписанных документов","Последняя подпись","Номер документа"],...confirmed.map(({party,option,history})=>[party.name,party.inn,party.kpp,option.operator,option.id,history.count,history.lastSignedAt,history.documentNumber])];
    const sheet=XLSX.utils.aoa_to_sheet(rows);
    sheet["!cols"]=[{wch:44},{wch:16},{wch:14},{wch:25},{wch:55},{wch:24},{wch:24},{wch:30}];
    const workbook=XLSX.utils.book_new();XLSX.utils.book_append_sheet(workbook,sheet,"Подтверждённые ID ЭДО");
    XLSX.writeFile(workbook,`edo-confirmed-${new Date().toISOString().slice(0,10)}.xlsx`);
    setMessage(`В Excel выгружено ${confirmed.length} контрагентов с подтверждённым выбранным ID ЭДО.`);
  }catch(error){setMessage(error instanceof Error?error.message:"Не удалось выгрузить Excel");}finally{setExporting(false);}};
  return <main className={styles.shell}>
    <header className={styles.topbar}><div>А</div><strong>Создание ЭПД <small>версия {appPackage.version}</small></strong><nav><a href="/workspace">Создание документов</a><a href="/forwarding-orders">Поручения клиентам</a><a href="/control">Контроль подписания</a><a href="/statistics">Статистика</a><a className={styles.active} href="/edo-settings">Настройки ID ЭДО</a></nav></header>
    <section className={styles.content}><header className={styles.heading}><div><small>СПРАВОЧНИК</small><h1>Настройки ID для ЭПД</h1><p>В таблице — все контрагенты с несколькими ID ЭДО. Ручной выбор остаётся доступен при раскрытии строки. В Excel попадают только подтверждённые выбранные ID.</p></div><div className={styles.headingActions}><button type="button" onClick={()=>void load()} disabled={loading}>{loading?"Проверяем…":"Обновить историю"}</button><button type="button" onClick={()=>void exportExcel()} disabled={loading||exporting||!confirmed.length}>{exporting?"Готовим Excel…":`Выгрузить подтверждённые (${confirmed.length})`}</button></div></header>
      <div className={styles.toolbar}><input aria-label="Поиск по контрагентам" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Название, ИНН, оператор или ID ЭДО"/><span role="status">{message}</span></div>
      <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Контрагент</th><th>ИНН / КПП</th><th>Варианты</th><th>Выбранный ID ЭДО</th><th>Подтверждение</th><th>Выбор</th></tr></thead><tbody>{filtered.map(party=>{const selected=selectedOption(party),chosen=drafts[party.key]??party.selectedId,changed=Boolean(drafts[party.key]&&drafts[party.key]!==party.selectedId),isExpanded=Boolean(expanded[party.key]);return <FragmentRow key={party.key} party={party} selected={selected} chosen={chosen} changed={changed} isExpanded={isExpanded} saving={saving===party.key} onToggle={()=>setExpanded(current=>({...current,[party.key]:!current[party.key]}))} onChoose={id=>setDrafts(current=>({...current,[party.key]:id}))} onSave={()=>void save(party)}/>;})}</tbody></table></div>
      {!loading&&!filtered.length&&<p className={styles.empty}>Ничего не найдено</p>}
    </section>
  </main>;
}

function FragmentRow({party,selected,chosen,changed,isExpanded,saving,onToggle,onChoose,onSave}:{party:Party;selected:Option|undefined;chosen:string;changed:boolean;isExpanded:boolean;saving:boolean;onToggle:()=>void;onChoose:(id:string)=>void;onSave:()=>void}){
  return <><tr><td><strong>{party.name}</strong></td><td>{party.inn}<span className={styles.secondary}>{party.kpp}</span></td><td>{party.options.length} ID</td><td className={styles.idCell}>{selected?<><strong>{selected.operator}</strong><span className={styles.secondary}>{selected.id}</span></>:"Не выбран"}</td><td>{selected?.history&&selected.history.count>0?<><span className={styles.confirmed}>Подтверждено подписью</span><span className={styles.secondary}>{selected.history.count} подписанных документов</span></>:<span className={styles.notConfirmed}>Нет подтверждённой подписи</span>}</td><td><button type="button" className={styles.expand} aria-expanded={isExpanded} onClick={onToggle}>{isExpanded?"Скрыть варианты":"Выбрать ID"}</button></td></tr>{isExpanded&&<tr className={styles.detailRow}><td colSpan={6}><div className={styles.options}>{party.options.map(option=><label key={option.id} className={chosen===option.id?styles.selected:""}><input type="radio" name={party.key} checked={chosen===option.id} onChange={()=>onChoose(option.id)}/><span><strong>{option.operator}</strong><small>{option.id}</small></span><em>{option.history?`Подписанных документов: ${option.history.count}`:"Подтверждённых подписей нет"}</em></label>)}</div><footer className={styles.saveBar}><span>{changed?"Новый ID выбран. Нажмите «Сохранить выбор».":"Сохранённый выбор не перезаписывается обновлениями. Ручной выбор без подписанного документа не считается подтверждением."}</span><button disabled={!chosen||!changed||saving} onClick={onSave}>{saving?"Сохраняем…":"Сохранить выбор"}</button></footer></td></tr>}</>;
}
