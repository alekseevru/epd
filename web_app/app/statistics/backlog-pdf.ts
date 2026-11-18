export type ReportRow = {label:string; total:number; completed:number};

const number = new Intl.NumberFormat("ru-RU");
const percent = new Intl.NumberFormat("ru-RU",{style:"percent",maximumFractionDigits:1});
const width=842, height=595;
const ink="#142832", muted="#435964", teal="#24566a", orange="#b75023", track="#e8dcd0";

export function topRecipients(rows: ReportRow[]): ReportRow[] {
  const sorted=[...rows].sort((a,b)=>(b.total-b.completed)-(a.total-a.completed)||b.total-a.total||a.label.localeCompare(b.label,"ru"));
  const rest=sorted.slice(10);
  return [...sorted.slice(0,10),...(rest.length?[{
    label:`Остальные (${rest.length})`,
    total:rest.reduce((n,row)=>n+row.total,0),
    completed:rest.reduce((n,row)=>n+row.completed,0),
  }]:[])];
}

// Package the two rendered pages as JPEG image XObjects in a PDF.
export function encodeReportPdf(images: Uint8Array<ArrayBuffer>[], pixelWidth: number, pixelHeight: number): Blob {
  const parts: BlobPart[]=[];
  const offsets=[0];
  const encoder=new TextEncoder();
  let length=0;
  const append=(value:string|Uint8Array<ArrayBuffer>)=>{
    const bytes=typeof value==="string"?encoder.encode(value):value;
    parts.push(bytes);length+=bytes.byteLength;
  };
  const object=(id:number,body:string,stream?:Uint8Array<ArrayBuffer>)=>{
    offsets[id]=length;append(`${id} 0 obj\n${body}`);
    if(stream){append("\nstream\n");append(stream);append("\nendstream");}
    append("\nendobj\n");
  };
  append("%PDF-1.4\n");
  object(1,"<< /Type /Catalog /Pages 2 0 R >>");
  object(2,`<< /Type /Pages /Count ${images.length} /Kids [${images.map((_,i)=>`${3+i*3} 0 R`).join(" ")}] >>`);
  images.forEach((bytes,i)=>{
    const id=3+i*3;
    object(id,`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /XObject << /Chart ${id+1} 0 R >> >> /Contents ${id+2} 0 R >>`);
    object(id+1,`<< /Type /XObject /Subtype /Image /Width ${pixelWidth} /Height ${pixelHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${bytes.length} >>`,bytes);
    const paint=encoder.encode(`q ${width} 0 0 ${height} 0 0 cm /Chart Do Q`);
    object(id+2,`<< /Length ${paint.length} >>`,paint);
  });
  const xref=length;
  append(`xref\n0 ${offsets.length}\n0000000000 65535 f \n`);
  for(const offset of offsets.slice(1))append(`${String(offset).padStart(10,"0")} 00000 n \n`);
  append(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts,{type:"application/pdf"});
}

export async function downloadBacklogPdf(period:string, months:ReportRow[], recipients:ReportRow[], filename:string) {
  const canvas=document.createElement("canvas");
  canvas.width=width*2;canvas.height=height*2;
  const ctx=canvas.getContext("2d");
  if(!ctx)throw new Error("Не удалось подготовить графики PDF");
  ctx.scale(2,2);
  const box=(x:number,y:number,w:number,h:number,color:string)=>{
    ctx.fillStyle=color;ctx.fillRect(x,y,w,h);
  };
  const text=(value:string,x:number,y:number,size=11,bold=false,color=ink,max?:number)=>{
    ctx.font=`${bold?"700":"400"} ${size}px system-ui, sans-serif`;
    ctx.fillStyle=color;
    if(max===undefined)ctx.fillText(value,x,y);
    else ctx.fillText(value,x,y,max);
  };
  const page=(title:string,subtitle:string)=>{
    box(0,0,width,height,"#faf5ef");
    text("АНАЛИТИКА ЭТрН",36,43,11,true,orange);
    text(title,36,80,30,true);
    text(subtitle,36,106,13,false,muted);
  };
  const capture=async()=>{
    const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,"image/jpeg",0.94));
    if(!blob)throw new Error("Не удалось сохранить страницу PDF");
    return new Uint8Array(await blob.arrayBuffer());
  };
  const total=months.reduce((s,r)=>s+r.total,0), done=months.reduce((s,r)=>s+r.completed,0);
  const ratio=(r:ReportRow)=>r.total?r.completed/r.total:0;
  const measures=[
    {title:"Рейсы TMS",value:number.format(total),get:(r:ReportRow)=>r.total,color:teal,format:number.format},
    {title:"Покрытие ЭТрН",value:total?percent.format(done/total):"—",get:ratio,color:teal,format:percent.format},
    {title:"Бэклог",value:number.format(total-done),get:(r:ReportRow)=>r.total-r.completed,color:orange,format:number.format},
  ];
  page("Рейсы TMS и покрытие ЭТрН",period);
  const recent=months.slice(-6);
  measures.forEach((m,i)=>{
    const x=36+i*261;
    box(x,140,248,360,"#fff");
    text(m.title,x+16,171,15,true);
    text(m.value,x+16,215,30,true);
    const max=i===1?1:Math.max(1,...recent.map(m.get));
    for(const [j,row] of recent.entries()){
      const y=257+j*37, value=m.get(row);
      text(row.label,x+16,y,9,false,muted,65);
      box(x+85,y-8,88,9,track);
      box(x+85,y-8,value/max*88,9,m.color);
      text(i===1&&!row.total?"—":m.format(value),x+179,y,9,true,ink,58);
    }
  });
  text(recent.length<months.length?"Графики: последние 6 месяцев выбранного периода. Итоги: весь выбранный период.":"Графики по месяцу доставки. Текущий месяц может быть неполным.",36,539,10,false,muted);
  text("Покрытие = рейсы с ЭТрН / все рейсы TMS. Бэклог = рейсы без ЭТрН.",36,560,10,false,muted);
  const overview=await capture();

  page("Срез по грузополучателям",`${period} / до 10 получателей с наибольшим бэклогом`);
  const shown=topRecipients(recipients);
  box(36,140,770,355,"#fff");
  text("Грузополучатель",52,165,11,true);
  measures.forEach((m,i)=>text(m.title,325+i*160,165,11,true));
  const maxima=measures.map((m,i)=>i===1?1:Math.max(1,...shown.map(m.get)));
  shown.forEach((r,i)=>{
    const y=190+i*27;
    text(r.label,52,y,10,false,ink,257);
    box(52,y+9,738,.7,track);
    measures.forEach((m,j)=>{
      const x=325+j*160, value=m.get(r);
      box(x,y-8,86,8,track);
      box(x,y-8,86*value/maxima[j],8,m.color);
      text(j===1&&!r.total?"—":m.format(value),x+94,y,10,true);
    });
  });
  text("«Остальные» объединяет всех грузополучателей вне первой десятки.",36,534,10,false,muted);
  text("Источник: статистика рейсов TMS и ЭТрН на портале.",36,555,10,false,muted);
  const url=URL.createObjectURL(encodeReportPdf([overview,await capture()],canvas.width,canvas.height));
  const link=document.createElement("a");
  link.href=url;link.download=filename;
  document.body.append(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),30_000);
}
