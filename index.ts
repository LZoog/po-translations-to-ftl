import fs from 'fs-extra'
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'
import gettextParser from 'gettext-parser'
import { parse, Entry, Identifier } from '@fluent/syntax'

interface FtlSet {
  ftlId: string
  translation: string
}

const poVarsRegex = /%\(.*?\)s/g

const license = `# This Source Code Form is subject to the terms of the Mozilla Public\n# License, v. 2.0. If a copy of the MPL was not distributed with this\n# file, You can obtain one at http://mozilla.org/MPL/2.0/.\n\n`

const { ftlDir, ftlFile, localeDir, poFile, otherFtlFile, trialRun } = yargs(
  hideBin(process.argv)
)
  .options({
    ftlDir: {
      type: 'string',
      demandOption: true,
      describe: 'The path to the .ftl file to be referenced',
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
    otherFtlFile: {
      type: 'string',
      describe:
        'The name of an existing .ftl file that may contain translated terms, e.g. "-product-firefox-account", that we can refer to for possible translations. If this is not supplied or no match is found, the English version will be output',
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

const getFtlSets = (ftlEntries: Entry[], termsOnly = false) => {
  const ftlSets: FtlSet[] = []
  const termReferences: FtlSet[] = []

  ftlEntries.forEach((entry) => {
    if (entry.type === 'Term') {
      termReferences.push({
        ftlId: `{ -${entry.id.name} }`,
        translation: entry.value.elements[0].value as string,
      })
      return
    }

    if (!termsOnly) {
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
        ftlSets.push({
          ftlId: (entry.id as Identifier).name,
          translation: engTranslation,
        })
      }
    }
  })

  // Some terms may contain others, e.g. "Firefox" and "Firefox accounts"
  // Since we replace strings in array order, we sort the array by string length
  termReferences.sort((a, b) => b.translation.length - a.translation.length)

  return { ftlSets, termReferences }
}

const getTranslationMap = (poContent: Buffer) => {
  const translationMap: { eng: string; translation: string }[] = []
  const parsedPo = gettextParser.po.parse(poContent).translations['']

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
  return translationMap
}

const getTranslations = (directory: string) => {
  const poContent = fs.readFileSync(
    `${localeDir}/${directory}/LC_MESSAGES/${poFile}`
  )
  const translationMap = getTranslationMap(poContent)

  let termTranslations: undefined | FtlSet[]

  if (otherFtlFile) {
    let otherFtlFileContent = ''

    try {
      otherFtlFileContent = fs
        .readFileSync(`${localeDir}/${directory}/${otherFtlFile}`)
        .toString('utf-8')
      const otherFtlEntries = parse(otherFtlFileContent, {}).body
      termTranslations = getFtlSets(otherFtlEntries, true).termReferences
    } catch (e) {
      // noop
    }
  }

  return { translationMap, termTranslations }
}

const isMessageReference = (translation: string) =>
  translation.startsWith('{') &&
  translation.endsWith('}') &&
  !translation.slice(1, -1).includes('}')

const getTranslatedFtl = (
  ftlSets: FtlSet[],
  engTermReferences: FtlSet[],
  directory: string
) => {
  const { translationMap, termTranslations } = getTranslations(directory)
  let translatedFtl = ''

  // include all terms, e.g. -product-firefox-accounts
  for (const termReference of engTermReferences) {
    if (termTranslations) {
      let translationFound = false
      for (const termTranslation of termTranslations) {
        if (termReference.ftlId === termTranslation.ftlId) {
          translationFound = true
          translatedFtl += `${termReference.ftlId} = ${termTranslation.translation}\n`
        }
      }
      // if the terms from `otherFtlFile` doesn't contain an existing matches, default to English
      if (!translationFound) {
        translatedFtl += `${termReference.ftlId} = ${termReference.translation}\n`
      }
    } else {
      translatedFtl += `${termReference.ftlId} = ${termReference.translation}\n`
    }
  }

  ftlSets.forEach((set) => {
    let translationFound = false

    for (const poSet of translationMap) {
      let poSetTranslation = poSet.translation
      let poSetEng = poSet.eng

      for (const termReference of engTermReferences) {
        // when we compare the ftl string to existing po translations, we replace term references
        // in the ftl string with its english translation
        if (poSetTranslation.includes(termReference.translation)) {
          poSetTranslation = poSetTranslation.replace(
            termReference.translation,
            termReference.ftlId
          )
        }
        if (poSetEng.includes(termReference.translation)) {
          poSetEng = poSetEng.replace(
            termReference.translation,
            termReference.ftlId
          )
        }
      }

      if (poSetTranslation) {
        // Curly quotes/apostrophes are preferred and the l10n team enforces them in ftl files.
        // It's possible po translations (and english ids) use straight quotes though, so we compare
        // both versions to find a matching translation and save the translation with curly quotes
        const ftlEngWithStraightQuotes = set.translation
          .replace('’', "'")
          .replace('‘', "'")
          .replace('“', '"')
          .replace('”', '"')

        if (
          poSetEng.trim() === set.translation.trim() ||
          poSetEng.trim() === ftlEngWithStraightQuotes.trim()
        ) {
          translationFound = true
          const translationCurlyQuotes = poSetTranslation
            .replace("'", '’')
            .replace("'", '‘')
            .replace('"', '“')
            .replace('"', '”')

          translatedFtl += `${set.ftlId} = ${translationCurlyQuotes}\n`
          break
        }
      }
    }

    // include IDs set to message references, e.g. `{ }`
    if (!translationFound && isMessageReference(set.translation)) {
      translatedFtl += `${set.ftlId} = ${set.translation}\n`
    }
  })

  return translatedFtl
}

const getLangDirs = async () => {
  const localeDirContent = await fs.readdir(localeDir)
  // only include directories and exclude the 'templates' + 'en' + 'en-US' directory
  const allLangDirs: string[] = (
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
    const { ftlSets, termReferences: engTermReferences } =
      getFtlSets(ftlEntries)

    langDirs.forEach((directory) => {
      const translatedFtl = getTranslatedFtl(
        ftlSets,
        engTermReferences,
        directory
      )

      // write to individual directories
      if (trialRun) {
        console.log(
          `==========\nContent to be written to ${localeDir}/${directory}/${ftlFile}:\n==========\n` +
            license +
            translatedFtl +
            '\n'
        )
      } else {
        try {
          fs.writeFile(
            `${localeDir}/${directory}/${ftlFile}`,
            translatedFtl + '\n'
          )
          console.log(
            `Successfully wrote to ${localeDir}/${directory}/${ftlFile}`
          )
        } catch (e) {
          console.log('Error writing ftl file: ', e)
        }
      }
    })

    // write to 'en' and 'templates' directory
    if (!trialRun) {
      try {
        fs.writeFile(`${localeDir}/en/${ftlFile}`, ftlContent)
        console.log(
          `\nSuccessfully copied ${ftlDir}/${ftlFile} to ${localeDir}/en/${ftlFile}`
        )
      } catch (e) {
        console.log('Error copying file: ', e)
      }

      try {
        fs.writeFile(`${localeDir}/templates/${ftlFile}`, ftlContent)
        console.log(
          `Successfully copied ${ftlDir}/${ftlFile} to ${localeDir}/templates/${ftlFile}`
        )
      } catch (e) {
        console.log('Error copying file: ', e)
      }
    }
  } catch (error) {
    console.log(error)
  }
})()
