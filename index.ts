
import fs from "fs-extra"
import yargs from 'yargs'
import { hideBin } from "yargs/helpers"

const { ftlDir, ftlFile, localeDir, poFile } = yargs(hideBin(process.argv)).options({
  ftlDir: {
    type: 'string', 
    demandOption: true,
    describe: 'The path to the directory containing the ftl file to be copied',
  },
  ftlFile: {
    type: 'string', 
    demandOption: true,
    describe: 'The name of the .ftl file to be copied',
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
// selects until the string contains a newline that does not begin with a space
const untilNewlineWithoutSpace = /(?:(?!(\n[a-z]))[\s\S])*/g

const getPoQuoteString = (string: String | undefined) => {
  if (string) {
    // some msgids begin with `""` and have the string on the next line, oftentimes with nested quotes and newlines. Remove `msgid ""\n` and combine separated lines if so.
    if (string.includes('msgid ""\n"')) {
      string = string.split('msgid ""\n').pop();
    }
    if (string?.includes('"\n"')) {
      string = string.replace('"\n"', "")
    }
    const match = string?.match(quotesRegex)
    // there should always be a match, but this makes TS happy
    if (match) {
      return match[0]
    }
  }
  return ""
}

const getFluentIdsAndStrings = (string: String) => {
  // filter out blank lines and comments
  const ftlConcatSets = string.match(untilNewlineWithoutSpace)!.filter(set => set !== '' && !set.startsWith("#"))
  return ftlConcatSets.map((concatSet) => {
    const [ ftlId, engTranslation] = concatSet.includes(' = ') ? concatSet.split(' = ') : concatSet.split(' =')
    // let [ftlId, engTranslation] = concatSet.split(' = ')
    // if (engTranslation === undefined) {
    //   [ftlId, engTranslation]
    // }
    return ({
      ftlId,
      engTranslation
    })
  })
}

// const copyFtlFile = () => {

// }

// const getPoFileTranslationMap = () => {

// }

// const getFtlTranslationMap = () => {
//   const ftlContent = fs.readFileSync(`${ftlDir}/${ftlFile}`).toString('utf-8')

// }

(async () => {
  try {
    const localeDirContent = await fs.readdir(localeDir)
    // only include directories
    const langDirs = await asyncFilter(localeDirContent, async(fileOrDirName: string) => (await fs.lstat(`${localeDir}/${fileOrDirName}`)).isDirectory())

    // this will be a for loop, just starting with one
    const directory = langDirs[0]
    const poContent = fs.readFileSync(`${localeDir}/${directory}/LC_MESSAGES/${poFile}`).toString('utf-8')
    const ftlContent = fs.readFileSync(`${ftlDir}/${ftlFile}`).toString('utf-8')
  
    if (poContent && ftlContent) {

      const ftlTranslationMap = getFluentIdsAndStrings(ftlContent)

      console.log(ftlTranslationMap)

      // fs.copyFileSync(`${ftlDir}/${ftlFile}`, `${localeDir}/${directory}/${ftlFile}`)

      // const poMsgConcatSets = poContent.split('\n\n')
      // const translationMap = poMsgConcatSets.map((concatSet) => {
      //   const poMsgSet = concatSet.split('\nmsgstr')
      //   return ({
      //     eng: getPoQuoteString(poMsgSet[0]),
      //     translation: getPoQuoteString(poMsgSet[1]),
      //   })
      // })

      // console.log(translationMap);
    }
  
  } catch(error) {
    console.log(error)
  }
})()