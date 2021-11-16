import fs from 'fs-extra'
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'
import gettextParser from 'gettext-parser'
import { parse, Resource, Pattern, Entry, Identifier } from '@fluent/syntax'
interface FtlSetWithComments {
  /** the single line or multi-line comment if one exists */
  comment: string | null
  ftlId: string
  engTranslation: string
  /** comment + ftlId + engTranslation */
  fullString: string
}
interface BrandReference {
  ftlId: string
  engTranslation: string
}

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

const convertPoVarsToFltVars = (poTranslation: string) => {
  const getConvertedPoTranslation = (
    poFtlVarMap: {
      poVar: string
      ftlVar: string
    }[]
  ) => {
    let convertedPoContent = poTranslation
    poFtlVarMap.forEach(({ poVar, ftlVar }) => {
      poTranslation.split(poVar).join()
      convertedPoContent = convertedPoContent.replace(poVar, ftlVar)
    })
    return convertedPoContent
  }

  const poVars = poTranslation.match(poVarsRegex)
  if (poVars) {
    const poFtlVarMap = poVars.map((poVar) => {
      const ftlVar = poVar.replace('%(', '{ $').replace(')s', ' }')
      return {
        poVar,
        ftlVar,
      }
    })
    return getConvertedPoTranslation(poFtlVarMap)
  }
  return poTranslation
}

const getFtlSets = (ftlEntries: Entry[]) => {
  const ftlSetsWithComments: FtlSetWithComments[] = []
  const brandReferences: BrandReference[] = []

  ftlEntries.forEach((entry) => {
    if (entry.type === 'Term') {
      brandReferences.push({
        ftlId: `{ -${entry.id.name} }`,
        engTranslation: entry.value.elements[0].value as string,
      })
      return
    }

    let engTranslation = ''
    // @ts-ignore - value is `Pattern || null`, elements `Array<PatternElement>`, but causes problems
    entry.value?.elements.forEach((element) => {
      if (element.value) {
        engTranslation += element.value
      } else if (element.expression.type === 'TermReference') {
        engTranslation += `{ -${element.expression.id.name} }`
      } else if (element.expression.type === 'VariableReference') {
        engTranslation += `{ $${element.expression.id.name} }`
      } else if (element.expression.id) {
        engTranslation += `{ ${element.expression.id.name} }`
      }
    })

    if (engTranslation) {
      // @ts-ignore, .content does exist on Comment
      const comment = entry.comment ? (entry.comment as Comment).content : null
      const ftlId = (entry.id as Identifier).name

      ftlSetsWithComments.push({
        comment,
        ftlId,
        engTranslation,
        fullString: `${
          comment ? comment + '\n' : ''
        }${ftlId} = ${engTranslation}`,
      })
    }
  })

  return { ftlSetsWithComments, brandReferences }
}

const getFtlContentWithTranslations = (
  ftlSetsWithComments: FtlSetWithComments[],
  brandReferences: BrandReference[],
  ftlContent: string,
  poContent: Buffer
) => {
  const parsedPo = gettextParser.po.parse(poContent).translations['']
  console.log('parsedPo!!', parsedPo)

  let translationMap = []
  for (const poId in parsedPo) {
    const translation = parsedPo[poId].msgstr[0]
    if (translation) {
      const translationWithFtlVars = convertPoVarsToFltVars(translation)

      translationMap.push({
        eng: poId,
        translation: translationWithFtlVars,
      })
    }
  }

  // ftlSetsWithComments.forEach((set) => {
  //   let translationFound = false
  //   for (const poSet of translationMap) {
  //     let poSetTranslation = poSet.translation
  //     let poSetEng = poSet.eng

  //     // if ftlId begins with `{ -`, like `{ -brand-mozilla }`, it's a brand message reference.
  //     // when we compare the ftl string to existing po translations, we replace that part of the ftl string
  //     // with what that message reference equals
  //     for (const brandReference of brandReferences) {
  //       if (poSetTranslation.includes(brandReference.engTranslation)) {
  //         poSetTranslation = poSet.translation.replace(
  //           brandReference.engTranslation,
  //           `{ ${brandReference.ftlId} }`
  //         )
  //       }
  //       if (poSetEng.includes(brandReference.engTranslation)) {
  //         poSetEng = poSet.eng.replace(
  //           brandReference.engTranslation,
  //           `{ ${brandReference.ftlId} }`
  //         )
  //       }
  //     }

  //     if (poSetTranslation !== '') {
  //       // If the ftl English translation contains curly quotes or apostrophes, we should convert
  //       // them to straight quotes and compare both versions to the po translations
  //       const ftlEngWithStraightQuotes = set.engTranslation
  //         .replace('’', "'")
  //         .replace('‘', "'")
  //         .replace('“', '"')
  //         .replace('”', '"')

  //       if (
  //         poSetEng.trim() === set.engTranslation.trim() ||
  //         poSetEng.trim() === ftlEngWithStraightQuotes.trim()
  //       ) {
  //         ftlContent = ftlContent.replace(set.engTranslation, poSetTranslation)
  //         translationFound = true
  //         break
  //       }
  //     }
  //   }
  //   // NOTE/TODO: this will set references with text between when these should be filtered out, e.g. `{ a } other copy { b }`
  //   if (
  //     !translationFound &&
  //     !(set.engTranslation.startsWith('{') && set.engTranslation.endsWith('}'))
  //   ) {
  //     // delete the line if no existing translation is found or if the line doesn't start/end with a variable reference
  //     const concatSetIndex = ftlContent.indexOf(set.fullString)
  //     const contentBeforeSet = ftlContent.substring(0, concatSetIndex - 1)
  //     const contentAfterSet = ftlContent.substring(
  //       concatSetIndex + set.fullString.length
  //     )
  //     ftlContent = contentBeforeSet + contentAfterSet
  //   }
  // })

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
    const ftlContent = fs.readFileSync(`${ftlDir}/${ftlFile}`).toString('utf-8')

    const ftlEntries = parse(ftlContent, {}).body
    const { ftlSetsWithComments, brandReferences } = getFtlSets(ftlEntries)

    langDirs.forEach((directory) => {
      const poContent = fs.readFileSync(
        `${localeDir}/${directory}/LC_MESSAGES/${poFile}`
      )

      const ftlContentWithTranslations = getFtlContentWithTranslations(
        ftlSetsWithComments,
        brandReferences,
        ftlContent,
        poContent
      )
    })

    // if (trialRun) {
    // console.log(
    //   `==========\nContent to be written to ${localeDir}/${directory}/${ftlFile}:\n==========\n` +
    //     ftlContentWithTranslations +
    //     '\n'
    // )
    // } else {
    //   try {
    //     fs.writeFile(
    //       `${localeDir}/${directory}/${ftlFile}`,
    //       ftlContentWithTranslations + '\n'
    //     )
    //     console.log(
    //       `Successfully wrote to ${localeDir}/${directory}/${ftlFile}`
    //     )
    //   } catch (e) {
    //     console.log('Error writing ftl file: ', e)
    //   }
    // }
    // })
    // }

    // if (!trialRun) {
    //   try {
    //     fs.writeFile(`${localeDir}/en/${ftlFile}`, ftlContent)
    //     console.log(
    //       `\nSuccessfully copied ${ftlDir}/${ftlFile} to ${localeDir}/en/${ftlFile}`
    //     )
    //   } catch (e) {
    //     console.log('Error copying file: ', e)
    //   }

    //   try {
    //     fs.writeFile(`${localeDir}/templates/${ftlFile}`, ftlContent)
    //     console.log(
    //       `Successfully copied ${ftlDir}/${ftlFile} to ${localeDir}/templates/${ftlFile}`
    //     )
    //   } catch (e) {
    //     console.log('Error copying file: ', e)
    //   }
  } catch (error) {
    console.log(error)
  }
})()
