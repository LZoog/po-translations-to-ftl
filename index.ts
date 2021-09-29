
import fs from "fs-extra"
import yargs from 'yargs'
import { hideBin } from "yargs/helpers"

const { ftlFile, localeDir, poFile } = yargs(hideBin(process.argv)).options({
  ftlFile: {
    type: 'string', 
    demandOption: true,
    describe: 'The path to the .ftl file to be copied',
  },
  poFile: {
    type: 'string', 
    demandOption: true,
    describe: 'The name of the .po file to reference current translations',
  },
  localeDir: { 
    type: 'string', 
    demandOption: true,
    describe: 'The path to the locale directory containing language directories, which contain an LC_MESSAGES directory with .po files',
  },
}).parseSync();

// Stolen from SO. TODO: log which promises failed
async function asyncFilter(arr: Array<string>, callback: Function) {
  const fail = Symbol()
  return (await Promise.all(arr.map(async (item: any) => (await callback(item)) ? item : fail))).filter(i=>i!==fail)
}

(async () => {
  try {
    const localeContent = await fs.readdir(localeDir)

    const langDirs = await asyncFilter(localeContent, async(fileOrDirName: string) => {
      const fileOrDir = await fs.lstat(`${localeDir}/${fileOrDirName}`)
      return fileOrDir.isDirectory();
    })

    console.log('langDirs', langDirs);

    const directory = langDirs[0];
    const poContent = fs.readFileSync(`${localeDir}/${directory}/LC_MESSAGES/${poFile}`);
  
    if (poContent) {
      console.log('poContent', poContent.toString('utf-8'))
    }
  
  } catch(error) {
    console.log(error)
  }
})()