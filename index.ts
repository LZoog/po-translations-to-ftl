import fs from 'fs-extra'
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'
interface FtlSetWithComments {
  /** the single line or multi-line comment if one exists */
  comment: String | null
  ftlId: string
  engTranslation: string
  /** comment + ftlId + engTranslation */
  fullString: string
}
interface BrandReference {
  ftlId: string
  engTranslation: string
}

const quotesRegex = /(?<=(["']))(?:(?=(\\?))\2.)*?(?=\1)/
// selects until the string contains a newline that does not begin with a space, #, or -
const fluentSetAndCommentsRegex = /(?:(?!(\n[a-z|#|-]))[\s\S])*/g
const poVarsRegex = /%\(.*?\)s/g

const { ftlDir, ftlFile, localeDir, poFile, trialRun } = yargs(
  hideBin(process.argv)
)
  .options({
    ftlDir: {
      type: 'string',
      demandOption: true,
      describe:
        'The path to the directory containing the ftl file to be referenced',
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
      describe:
        'The path to the locale directory containing language directories, which contain an LC_MESSAGES directory with .po files',
    },
    trialRun: {
      type: 'boolean',
      default: false,
      describe:
        'Instead of writing all .ftl files to disk, console log the first two to verify they look as expected',
    },
  })
  .parseSync()

// Stolen from SO. TODO: log which promises failed
async function asyncFilter(arr: Array<string>, callback: Function) {
  const fail = Symbol()
  return (
    await Promise.all(
      arr.map(async (item: any) => ((await callback(item)) ? item : fail))
    )
  ).filter((i) => i !== fail)
}

// we can grab the fluent ID/message by using what's on the left/hand side of ' = '
// except for blocks where they may begin on the next line (' ='). Needs tweaking for
// nested strings with multiple `=`
const getFtlIdAndString = (match: String) => {
  const [ftlId, engTranslation] = match.includes(' = ')
    ? match.split(' = ')
    : match.split(' =')
  return { ftlId, engTranslation }
}

const isBrandReference = (ftlId: String) =>
  ftlId.startsWith('-') && ftlId.includes('brand')

const getPoQuoteString = (string: String | undefined) => {
  if (string) {
    // some msgids begin with `""` and have the string on the next line, oftentimes with nested quotes and newlines.
    // Remove `msgid ""\n` and combine separated lines if so.
    if (string.includes('msgid ""\n"')) {
      string = string.split('msgid ""\n').pop()
    }
    if (string?.includes('"\n"')) {
      string = string.replace('"\n"', '')
    }
    const match = string?.match(quotesRegex)
    // there should always be a match, but this makes TS happy
    if (match) {
      return match[0]
    }
  }
  return ''
}

const convertPoVarsToFltVars = (poContent: String) => {
  const getConvertedPoContent = (
    poFtlVarMap: {
      poVar: string
      ftlVar: string
    }[]
  ) => {
    let convertedPoContent = poContent
    poFtlVarMap.forEach(({ poVar, ftlVar }) => {
      poContent.split(poVar).join()
      convertedPoContent = convertedPoContent.replace(poVar, ftlVar)
    })
    return convertedPoContent
  }
  const poVars = poContent.match(poVarsRegex)

  if (poVars) {
    const poFtlVarMap = poVars.map((poVar) => {
      const ftlVar = poVar.replace('%(', '{ $').replace(')s', ' }')
      return {
        poVar,
        ftlVar,
      }
    })
    return getConvertedPoContent(poFtlVarMap)
  }
  return poContent
}

/**
 * @param ftlConcatSetsWithComments Contains every single line (including each commented line) or
 *  multi-line block from the ftl file except blank lines.
 */
const getFtlSets = (ftlConcatSetsWithComments: string[]) => {
  const ftlSetsWithComments: FtlSetWithComments[] = []
  const brandReferences: BrandReference[] = []
  let matchIndex = 0
  ftlConcatSetsWithComments.forEach((match, index) => {
    // don't iterate over match if it's been reached in the inner loop
    if (matchIndex <= index) {
      if (!match.startsWith('#')) {
        const { ftlId, engTranslation } = getFtlIdAndString(match)

        if (isBrandReference(ftlId)) {
          const brand = engTranslation.replace('\n', '').trim()
          brandReferences.push({
            ftlId,
            engTranslation: brand,
          })
        }
        ftlSetsWithComments.push({
          comment: null,
          ftlId,
          engTranslation,
          fullString: match,
        })
      } else {
        let comment = match
        // if the match is a comment, include next lines until reaching the first non-comment
        for (let i = index + 1; i < ftlConcatSetsWithComments.length; i++) {
          if (ftlConcatSetsWithComments[i].startsWith('#')) {
            comment += '\n' + ftlConcatSetsWithComments[i]
            matchIndex = i + 2
          } else {
            const ftlIdAndTranslation = ftlConcatSetsWithComments[i]
            const { ftlId, engTranslation } =
              getFtlIdAndString(ftlIdAndTranslation)

            if (isBrandReference(ftlId)) {
              brandReferences.push({
                ftlId,
                engTranslation,
              })
            }
            ftlSetsWithComments.push({
              comment,
              ftlId,
              engTranslation,
              fullString: comment + '\n' + ftlIdAndTranslation,
            })
            matchIndex = i + 1
            break
          }
        }
      }
    }
  })
  return { ftlSetsWithComments, brandReferences }
}

const getFtlContentWithTranslations = (
  ftlSetsWithComments: FtlSetWithComments[],
  brandReferences: BrandReference[],
  ftlContent: String,
  poContent: String
) => {
  const poMsgConcatSets = convertPoVarsToFltVars(poContent).split('\n\n')

  const translationMap = poMsgConcatSets.map((concatSet) => {
    const poMsgSet = concatSet.split('\nmsgstr')
    return {
      eng: getPoQuoteString(poMsgSet[0]),
      translation: getPoQuoteString(poMsgSet[1]),
    }
  })

  ftlSetsWithComments.forEach((set) => {
    let translationFound = false
    for (const poSet of translationMap) {
      // if ftlId begins with `{ -`, like `{ -brand-mozilla }`, it's a brand message reference.
      // when we compare the ftl string to existing po translations, we replace that part of the ftl string
      // with what that message reference equals
      let poSetTranslation = poSet.translation
      let poSetEng = poSet.eng
      for (const BrandReference of brandReferences) {
        if (poSetTranslation.includes(BrandReference.engTranslation)) {
          poSetTranslation = poSet.translation.replace(
            BrandReference.engTranslation,
            `{ ${BrandReference.ftlId} }`
          )
        }
        if (poSetEng.includes(BrandReference.engTranslation)) {
          poSetEng = poSet.eng.replace(
            BrandReference.engTranslation,
            `{ ${BrandReference.ftlId} }`
          )
        }
      }

      // TODO: ftl should be in curly quotes, but we should also normalize straight
      // quotes with curly for translation comparison
      if (poSetTranslation !== '' && poSetEng === set.engTranslation) {
        ftlContent = ftlContent.replace(set.engTranslation, poSetTranslation)
        translationFound = true
        break
      }
    }
    // NOTE/TODO: this will set references with text between when these should be filtered out, e.g. `{ a } other copy { b }`
    if (
      !translationFound &&
      !(set.engTranslation.startsWith('{') && set.engTranslation.endsWith('}'))
    ) {
      // delete the line if no existing translation is found or if the line doesn't start/end with a variable reference
      const concatSetIndex = ftlContent.indexOf(set.fullString)
      const contentBeforeSet = ftlContent.substring(0, concatSetIndex - 1)
      const contentAfterSet = ftlContent.substring(
        concatSetIndex + set.fullString.length
      )
      ftlContent = contentBeforeSet + contentAfterSet
    }
  })

  return ftlContent
}

const getLangDirs = async () => {
  const localeDirContent = await fs.readdir(localeDir)
  // only include directories and exclude the 'templates' + 'en' + 'en-US' directory
  const allLangDirs: String[] = (
    await asyncFilter(localeDirContent, async (fileOrDirName: string) =>
      (await fs.lstat(`${localeDir}/${fileOrDirName}`)).isDirectory()
    )
  ).filter(
    (directory) =>
      directory !== 'templates' && directory !== 'en' && directory !== 'en-US'
  )
  return trialRun ? [allLangDirs[0], allLangDirs[1]] : allLangDirs
}

;(async () => {
  try {
    const langDirs = await getLangDirs()

    langDirs.forEach((directory) => {
      const poContent = fs
        .readFileSync(`${localeDir}/${directory}/LC_MESSAGES/${poFile}`)
        .toString('utf-8')
      const ftlContent = fs
        .readFileSync(`${ftlDir}/${ftlFile}`)
        .toString('utf-8')

      // an array of every line from the ftl file except blank lines. A multi-line ftl block will be one string
      const ftlConcatSetsWithComments = ftlContent
        .match(fluentSetAndCommentsRegex)!
        .filter((set) => set !== '')

      // TODO: need to make this more dynamic 🙃
      // This is equal to the number of comments above the first comment that should attach to an ftl id.
      ftlConcatSetsWithComments.splice(0, 7).join('\n')
      const { ftlSetsWithComments, brandReferences } = getFtlSets(
        ftlConcatSetsWithComments
      )
      const ftlContentWithTranslations = getFtlContentWithTranslations(
        ftlSetsWithComments,
        brandReferences,
        ftlContent,
        poContent
      )

      if (trialRun) {
        console.log(
          `==========\nContent to be written to ${localeDir}/${directory}/${ftlFile}:\n==========\n` +
            ftlContentWithTranslations +
            '\n'
        )
      } else {
        fs.writeFile(
          `${localeDir}/${directory}/${ftlFile}`,
          ftlContentWithTranslations + '\n'
        )
        fs.writeFile(`${localeDir}/en/${ftlFile}`, ftlContent)
      }
    })
  } catch (error) {
    console.log(error)
  }
})()
