import axios from 'axios'
import * as URL from 'url-parse'
import * as pathToRegExp from 'path-to-regexp'

import { ISummary } from '../../interfaces'
import { SummarizerNotFoundError } from '../../errors'
import { commonAxiosErrorHandler as commonAxiosErrorHandlerGenerator } from './common'

import general from './general'

const githubAPIBase = 'https://api.github.com'
const commonAxiosErrorHandler = commonAxiosErrorHandlerGenerator(data => {
  if (typeof data !== 'object') return null
  return data.message
})

type TSubSummarizer = (...args: string[]) => Promise<ISummary>
type TSubSummarizers = Map<RegExp, TSubSummarizer>

const repository: TSubSummarizer = (user: string, repository: string): Promise<ISummary> => {
  return axios.get(`${githubAPIBase}/repos/${user}/${repository}`)
    .then(response => {
      const {
        full_name: title,
        description,
        html_url: canonical,
        owner: { avatar_url: image }
      } = response.data
      return {
        title, canonical, image,
        description:
          description
            ? `${title} - ${description}`
            : `Contribute to ${title} development by creating an account on GitHub.`,
        type: 'object'
      }
    })
    .catch(commonAxiosErrorHandler)
}

const tag: TSubSummarizer = (user: string, repositoryName: string, tag: string) => {
  return Promise.all([
    repository(user, repositoryName),
    // check existance of tag
    axios.head(`${githubAPIBase}/repos/${user}/${repositoryName}/git/refs/tags/${tag}`)
  ])
    .then(([ repo ]) => {
      return Object.assign(repo, {
        canonical: `${repo.canonical}/releases/tag/${tag}`
      })
    })
    .catch(commonAxiosErrorHandler)
}

const commit: TSubSummarizer = (user: string, repositoryName: string, sha: string): Promise<ISummary> => {
  return Promise.all([
    axios.get(`${githubAPIBase}/repos/${user}/${repositoryName}/commits/${sha}`),
    repository(user, repositoryName)
  ])
    .then(([commit, repo]) => {
      const {
        author: { avatar_url: image },
        commit: { message },
        html_url: canonical
      } = commit.data
      const [title, ...desca] = message.split('\n\n', 2)
      const description = desca.join('\n\n') || repo.description
      return {
        title, description, canonical, image,
        type: 'object'
      }
    })
    .catch(commonAxiosErrorHandler)
}

const repositorySubcontents = [
  // top-level
  'pulls', 'issues', 'projects', 'wiki',
  // code
  'releases', 'tags', 'branches',
  // issues
  'milestones', 'labels',
  // insights
  'pulse', 'graphs/contributors', 'community', 'graphs/commit-activity', 'graphs/code-frequency', 'network/dependencies', 'network', 'members'
]
const repositorySubcontantsWrapper: TSubSummarizer = (...args: string[]): Promise<ISummary> => {
  const name = args[2]
  if (!repositorySubcontents.includes(name)) throw new SummarizerNotFoundError(`https://github.com/${args.join('/')}`)
  return repository(...args)
    .then((summary: ISummary) => Object.assign(summary, {
      title: !name.includes('/') ? `${name.substr(0, 1).toUpperCase() + name.substr(1)} \u00b7 ${summary.title}` : summary.title,
      canonical: `${summary.canonical}/${name}`
    }))
}

const summarizers: TSubSummarizers = new Map([
  [ pathToRegExp('/'), () => general('https://github.com/humans.txt', 'en') ],
  [ pathToRegExp('/:user/:repository'), repository ],
  [ pathToRegExp('/:user/:repository/releases/tag/:tag'), tag ],
  [ pathToRegExp('/:user/:repository/commit/:sha'), commit ],
  [ pathToRegExp('/:user/:repository/(.*)'), repositorySubcontantsWrapper ]
])

export default (gURL: string): Promise<ISummary> => {
  const url = URL(gURL)
  const pathname = url.pathname || '/'
  for (const [matcher, summarizer] of summarizers) {
    if (matcher.test(pathname)) {
      const args = (
        (): string[] => {
          const r = matcher.exec(pathname)
          if (r === null) throw new Error('something happened...')
          r.shift()
          return r
        }
      )()
      return summarizer(...args).then(
        (summary: ISummary) => Object.assign(
          {
            lang: 'en',
            icon: 'https://assets-cdn.github.com/favicon.ico',
            site_name: 'GitHub'
          },
          summary
        )
      )
    }
  }
  return Promise.reject(new SummarizerNotFoundError(gURL))
}
