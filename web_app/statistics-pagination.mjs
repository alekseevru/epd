const monthStart=value=>{
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(value))throw new Error("Некорректный отчётный месяц");
  const [year,month]=value.split("-").map(Number);
  return new Date(Date.UTC(year,month-1,1));
};
const diadocDate=value=>`${String(value.getUTCDate()).padStart(2,"0")}.${String(value.getUTCMonth()+1).padStart(2,"0")}.${value.getUTCFullYear()}`;

export async function loadMonthlyDocuments(startMonth,endMonth,fetchPage){
  const start=monthStart(startMonth),end=monthStart(endMonth);
  if(start>end)throw new Error("Конец периода раньше начала");
  const documents=[];
  for(let cursor=start;cursor<=end;cursor.setUTCMonth(cursor.getUTCMonth()+1)){
    const month=cursor.toISOString().slice(0,7);
    const fromDocumentDate=diadocDate(cursor);
    const toDocumentDate=diadocDate(new Date(Date.UTC(cursor.getUTCFullYear(),cursor.getUTCMonth()+1,0)));
    let afterIndexKey="",received=0,complete=false;
    for(let page=0;page<1000;page++){
      const result=await fetchPage({fromDocumentDate,toDocumentDate,afterIndexKey});
      if(!Array.isArray(result?.Documents))throw new Error(`Диадок не вернул список ЭТрН за ${month}`);
      const portion=result.Documents;
      documents.push(...portion);
      received+=portion.length;
      if(portion.length<100||result.TotalCount!=null&&Number.isFinite(Number(result.TotalCount))&&received>=Number(result.TotalCount)){
        complete=true;
        break;
      }
      const next=portion.at(-1)?.IndexKey||"";
      if(!next||next===afterIndexKey)throw new Error(`Не удалось дочитать ЭТрН за ${month}: отсутствует ключ следующей страницы`);
      afterIndexKey=next;
    }
    if(!complete)throw new Error(`Не удалось дочитать все ЭТрН за ${month}: достигнут предел страниц`);
  }
  return documents;
}
