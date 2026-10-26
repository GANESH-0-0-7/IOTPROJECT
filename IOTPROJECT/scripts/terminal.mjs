import {createInterface} from 'node:readline/promises';
import {stdin,stdout} from 'node:process';
export const terminal=createInterface({input:stdin,output:stdout});
export async function hidden(prompt){
  if(!stdin.isTTY)throw new Error('Use an interactive terminal for password entry.');
  stdout.write(prompt);terminal.close();stdin.setRawMode(true);stdin.resume();let value='';
  return new Promise((resolve,reject)=>{
    const finish=()=>{stdin.setRawMode(false);stdin.removeListener('data',handler);stdin.pause();stdout.write('\n');};
    const handler=chunk=>{for(const c of chunk.toString()){
      if(c==='\r'||c==='\n'){finish();resolve(value);return;}
      if(c==='\u0003'){finish();reject(new Error('Canceled.'));return;}
      if(c==='\u007f'||c==='\b')value=value.slice(0,-1);else value+=c;
    }};stdin.on('data',handler);
  });
}
