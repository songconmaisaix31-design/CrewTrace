import { parse } from 'csv-parse/sync';
import { AppError } from './errors.js';
export function inspectCSV(input:string){
  let rows:string[][];
  try{rows=parse(input,{bom:true,skip_empty_lines:true,max_record_size:100000});}
  catch{throw new AppError(422,'INVALID_CSV','CSV 列数或引号格式不正确，请检查原文');}
  if(rows.length<2||rows[0].length>100||rows.length>10001)throw new AppError(422,'INVALID_CSV','请提供表头和 1–10000 行记录，最多 100 列');
  const [header,...data]=rows;
  const duplicate=data.length-new Set(data.map(row=>JSON.stringify(row))).size;
  const cell=(v:string)=>v.replace(/[|\r\n]/g,' ');
  const columns=header.map((name,i)=>{
    const values=data.map(r=>r[i].trim());const present=values.filter(Boolean);
    const numeric=present.length>0&&present.every(v=>/^-?\d+(\.\d+)?$/.test(v)&&Number.isFinite(Number(v)));
    const total=numeric?present.reduce((sum,v)=>sum+Number(v),0):null;
    return `| ${cell(name)||'(未命名)'} | ${values.length-present.length} | ${new Set(present).size} | ${numeric?'数值':'文本'} | ${total===null?'—':Number.isFinite(total)?total.toFixed(2):'超出数值范围'} |`;
  });
  return `# CSV 数据质量报告\n\n本报告由 CrewTrace Data 对本次提交的原始 CSV 计算生成。\n\n- 数据行数：${data.length}\n- 字段数量：${header.length}\n- 完全重复的记录：${duplicate}\n- 重复表头：${header.length-new Set(header).size}\n\n| 字段 | 空值数 | 非空唯一值 | 类型 | 数值合计 |\n| --- | ---: | ---: | --- | ---: |\n${columns.join('\n')}\n\n## 验收建议\n\n核对行数与源文件；确认重复记录是否符合业务规则；逐列处理空值。数值合计不做货币精算，不对数据来源或业务真实性作判断。`;
}
