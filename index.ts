
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
const untilNewlineWithoutSpaceRegex = /(?:(?!(\n[a-z]))[\s\S])*/g
const poVarsRegex = /%\(.*?\)s/g

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


const convertPoVarsToFltVars = (poContent: String) => {
  const getConvertedPoContent = (poFtlVarMap: {
    poVar: string;
    ftlVar: string;
  }[] ) => {
    let convertedPoContent = poContent;
    poFtlVarMap.forEach(({poVar, ftlVar}) => {
      poContent.split(poVar).join()
      convertedPoContent = convertedPoContent.replace(poVar, ftlVar);
    })
    return convertedPoContent;
  }
  const poVars = poContent.match(poVarsRegex)

  if (poVars) {
    const poFtlVarMap = poVars.map((poVar) => {
      const ftlVar = poVar.replace('%(', '{ $').replace(')s', ' }')
      return ({
        poVar,
        ftlVar
      })
    })
    return getConvertedPoContent(poFtlVarMap);
  }
  return poContent;
}

(async () => {
  try {
    const localeDirContent = await fs.readdir(localeDir)
    // only include directories and exclude a 'templates' directory
    const langDirs = (await asyncFilter(localeDirContent, async(fileOrDirName: string) => (await fs.lstat(`${localeDir}/${fileOrDirName}`)).isDirectory())).filter(directory => directory !== 'templates')

    // comment out this for loop and change to const directory = langDirs[0] to check content before writing
    langDirs.forEach((directory) => {
      const poContent = fs.readFileSync(`${localeDir}/${directory}/LC_MESSAGES/${poFile}`).toString('utf-8')
  
      fs.copyFileSync(`${ftlDir}/${ftlFile}`, `${localeDir}/${directory}/${ftlFile}`)
      let ftlContent = fs.readFileSync(`${localeDir}/${directory}/${ftlFile}`).toString('utf-8')
  
      // uncomment this (and comment out two lines above) to log
      // let ftlContent = fs.readFileSync(`${ftlDir}/${ftlFile}`).toString('utf-8')
    
      if (poContent && ftlContent) {
        const poMsgConcatSets = convertPoVarsToFltVars(poContent).split('\n\n')
  
        const translationMap = poMsgConcatSets.map((concatSet) => {
          const poMsgSet = concatSet.split('\nmsgstr')
          return ({
            eng: getPoQuoteString(poMsgSet[0]),
            translation: getPoQuoteString(poMsgSet[1]),
          })
        })
  
        // filter out blank lines and comments
        const ftlConcatSets = ftlContent.match(untilNewlineWithoutSpaceRegex)!.filter(set => set !== '' && !set.startsWith("#"))
        ftlConcatSets.forEach((concatSet) => {
          // we can grab the fluent ID/message reliably by using what's on the left/hand side of ' = ' 
          // except for blocks where they may begin on the next line (' =')
          const [ ftlId, engTranslation ] = concatSet.includes(' = ') ? concatSet.split(' = ') : concatSet.split(' =')
  
          let translationFound = false
          for (const poSet of translationMap) {
            if (poSet.eng === engTranslation && poSet.translation !== "") {
              ftlContent = ftlContent.replace(engTranslation, poSet.translation)
              translationFound = true
              break;
            }
          }
          // NOTE/TODO: this will set references with text between when these should be filtered out, e.g. `{ a } other copy { b }`
          if (!translationFound && !(engTranslation.startsWith('{') && engTranslation.endsWith('}'))) {
            // delete the line if no existing translation is found
            const concatSetIndex = ftlContent.indexOf(concatSet)
            const contentBeforeSet = ftlContent.substring(0, concatSetIndex - 1)
            const contentAfterSet = ftlContent.substring(concatSetIndex + concatSet.length)
            ftlContent = contentBeforeSet + contentAfterSet
          }
        })
        fs.writeFile(`${localeDir}/${directory}/${ftlFile}`, ftlContent)
      }
    })
    // uncomment this to check content before writing
    // console.log(ftlContent)
  
  } catch(error) {
    console.log(error)
  }
})()