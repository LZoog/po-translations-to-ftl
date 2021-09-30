
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

const quotesRegex = /(?<=(["']))(?:(?=(\\?))\2.)*?(?=\1)/;

const getQuoteString = (string: String | undefined) => {
  if (string) {
    // some msgids begin with `""` and have the string on the next line, oftentimes with nested quotes and newlines. Remove `msgid ""\n` and combine separated lines if so.
    if (string.includes('msgid ""\n"')) {
      string = string.split('msgid ""\n').pop();
    }
    if (string?.includes('"\n"')) {
      string = string.replace('"\n"', "")
    }
    const match = string!.match(quotesRegex)
    // there should always be a match, but this makes TS happy
    if (match) {
      return match[0]
    }
  }
  return ""
}

(async () => {
  try {
    const localeDirContent = await fs.readdir(localeDir)
    const langDirs = await asyncFilter(localeDirContent, async(fileOrDirName: string) => (await fs.lstat(`${localeDir}/${fileOrDirName}`)).isDirectory())

    // this will be a for loop, just starting with one
    const directory = langDirs[0]
    const poContent = fs.readFileSync(`${localeDir}/${directory}/LC_MESSAGES/${poFile}`)
  
    if (poContent) {
      const poMsgConcatSets = poContent.toString('utf-8').split('\n\n')
      const translationMap = poMsgConcatSets.map((concatSet) => {
        const poMsgSet = concatSet.split('\nmsgstr')
        return ({
          eng: getQuoteString(poMsgSet[0]),
          translation: getQuoteString(poMsgSet[1]),
        })
      })

      console.log(translationMap);
    }
  
  } catch(error) {
    console.log(error)
  }
})()