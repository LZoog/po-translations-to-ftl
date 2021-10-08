
import fs from 'fs-extra'
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'

const { ftlDir, ftlFile, localeDir, poFile, trialRun } = yargs(hideBin(process.argv)).options({
  ftlDir: {
    type: 'string', 
    demandOption: true,
    describe: 'The path to the directory containing the ftl file to be referenced',
  },
  ftlFile: {
    type: 'string', 
    demandOption: true,
    describe: 'The name of the .ftl file to be referenced',
  },
  poFile: {
    type: 'string', 
    demandOption: true,
    describe: 'The name of the .po file to copy existing translations from',
  },
  localeDir: { 
    type: 'string', 
    demandOption: true,
    describe: 'The path to the locale directory containing language directories, which contain an LC_MESSAGES directory with .po files',
  },
  trialRun: { 
    type: 'boolean', 
    default: false,
    describe: 'Instead of writing all .ftl files to disk, console log the first two to verify they look as expected',
  },
}).parseSync()

// Stolen from SO. TODO: log which promises failed
async function asyncFilter(arr: Array<string>, callback: Function) {
  const fail = Symbol()
  return (await Promise.all(arr.map(async (item: any) => (await callback(item)) ? item : fail))).filter(i=>i!==fail)
}

const quotesRegex = /(?<=(["']))(?:(?=(\\?))\2.)*?(?=\1)/
// selects until the string contains a newline that does not begin with a space or a #
const untilNewlineWithoutSpaceRegex = /(?:(?!(\n[a-z|#]))[\s\S])*/g
const poVarsRegex = /%\(.*?\)s/g

const getPoQuoteString = (string: String | undefined) => {
  if (string) {
    // some msgids begin with `""` and have the string on the next line, oftentimes with nested quotes and newlines. Remove `msgid ""\n` and combine separated lines if so.
    if (string.includes('msgid ""\n"')) {
      string = string.split('msgid ""\n').pop()
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
    let convertedPoContent = poContent
    poFtlVarMap.forEach(({poVar, ftlVar}) => {
      poContent.split(poVar).join()
      convertedPoContent = convertedPoContent.replace(poVar, ftlVar)
    })
    return convertedPoContent
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
    return getConvertedPoContent(poFtlVarMap)
  }
  return poContent
}

interface SetWithComments {
  /** the single line or multi-line comment if one exists */
  comment: String | null;
  ftlId: string;
  engTranslation: string;
  /** comment + ftlId + engTranslation */
  fullString: string
}

/**
 * @param ftlConcatSetsWithComments Contains every single line (including each commented line) or multi-line block from the ftl file except blank lines.
 */
const getSetsWithComments = (ftlConcatSetsWithComments: string[]) => {
  const setsWithComments: SetWithComments[] = []
  let matchIndex = 0
  ftlConcatSetsWithComments.forEach((match, index) => {
    // don't iterate over match if it's been reached in the inner loop
    if (matchIndex <= index) {
      if (!match.startsWith('#')) {
        // we can grab the fluent ID/message by using what's on the left/hand side of ' = ' 
        // except for blocks where they may begin on the next line (' ='). Needs tweaking for 
        // nested strings with multiple `=` 
        const [ ftlId, engTranslation ] = match.includes(' = ') ? match.split(' = ') : match.split(' =')
        setsWithComments.push({
          comment: null,
          ftlId,
          engTranslation,
          fullString: match,
        })
      } else {
        let comment = match
        for (let i = index + 1; i < ftlConcatSetsWithComments.length; i++) {
          if (ftlConcatSetsWithComments[i].startsWith('#')) {
            comment += '\n' + ftlConcatSetsWithComments[i]
          } else {
            const ftlIdAndTranslation = ftlConcatSetsWithComments[i]
            const [ ftlId, engTranslation ] = ftlIdAndTranslation.includes(' = ') ? ftlIdAndTranslation.split(' = ') : match.split(' =')
            setsWithComments.push({
              comment,
              ftlId,
              engTranslation,
              fullString: comment + '\n' + ftlIdAndTranslation,
            })
            break
          }
          matchIndex = i + 2
        }
      }
    }
  })
  return setsWithComments
}

const getFtlContentWithTranslations = (ftlSetsWithComments: SetWithComments[], ftlContent: String, poContent: String) => {
  const poMsgConcatSets = convertPoVarsToFltVars(poContent).split('\n\n')
  
  const translationMap = poMsgConcatSets.map((concatSet) => {
    const poMsgSet = concatSet.split('\nmsgstr')
    return ({
      eng: getPoQuoteString(poMsgSet[0]),
      translation: getPoQuoteString(poMsgSet[1]),
    })
  })

  ftlSetsWithComments.forEach((set) => {
    let translationFound = false
    for (const poSet of translationMap) {
      if (poSet.eng === set.engTranslation && poSet.translation !== "") {
        ftlContent = ftlContent.replace(set.engTranslation, poSet.translation)
        translationFound = true
        break
      }
    }
    // NOTE/TODO: this will set references with text between when these should be filtered out, e.g. `{ a } other copy { b }`
    if (!translationFound && !(set.engTranslation.startsWith('{') && set.engTranslation.endsWith('}'))) {
      // delete the line if no existing translation is found
      const concatSetIndex = ftlContent.indexOf(set.fullString)
      const contentBeforeSet = ftlContent.substring(0, concatSetIndex - 1)
      const contentAfterSet = ftlContent.substring(concatSetIndex + set.fullString.length)
      ftlContent = contentBeforeSet + contentAfterSet
    }
  })

  return ftlContent
}

const getLangDirs = async () => {
  const localeDirContent = await fs.readdir(localeDir)
  // only include directories and exclude the 'templates' + 'en' directory
  const allLangDirs: String[] = (await asyncFilter(localeDirContent, async(fileOrDirName: string) => (await fs.lstat(`${localeDir}/${fileOrDirName}`)).isDirectory())).filter(directory => directory !== 'templates' && directory !== 'en')
  return trialRun ? [allLangDirs[0], allLangDirs[1]] : allLangDirs
}

(async () => {
  try {
    const langDirs = await getLangDirs()

    langDirs.forEach((directory) => {
      const poContent = fs.readFileSync(`${localeDir}/${directory}/LC_MESSAGES/${poFile}`).toString('utf-8')
      const ftlContent = fs.readFileSync(`${ftlDir}/${ftlFile}`).toString('utf-8')
    
      // an array of every line from the ftl file except blank lines. A multi-line ftl block will be one string
      const ftlConcatSetsWithComments = ftlContent.match(untilNewlineWithoutSpaceRegex)!.filter(set => set !== '')
      ftlConcatSetsWithComments.splice(0, 4) // header comment

      const ftlSetsWithComments = getSetsWithComments(ftlConcatSetsWithComments)
      const ftlContentWithTranslations = getFtlContentWithTranslations(ftlSetsWithComments, ftlContent, poContent)

      if (trialRun) {
        console.log(`==========\nContent to be written to ${localeDir}/${directory}/${ftlFile}:\n==========\n`, ftlContentWithTranslations + '\n')
      } else {
        fs.writeFile(`${localeDir}/${directory}/${ftlFile}`, ftlContentWithTranslations + '\n')
      }
    })
  } catch(error) {
    console.log(error)
  }
})()