import { useMemo } from 'react'

type CalculatorPanelProps = {
  query: string
  trigger: string
  setQuery: (nextQuery: string) => void
}

const normalizeExpression = (value: string) =>
  value
    .trim()
    .replace(/[×xX]/g, '*')
    .replace(/÷/g, '/')
    .replace(/[（]/g, '(')
    .replace(/[）]/g, ')')
    .replace(/[，]/g, ',')

const formatResult = (value: number) => {
  if (Number.isInteger(value)) {
    return new Intl.NumberFormat('en-US').format(value)
  }

  return value.toFixed(10).replace(/\.?0+$/, '')
}

const isDigit = (value: string) => value >= '0' && value <= '9'

const parseCalculation = (input: string) => {
  const expression = input.replace(/,/g, '')
  let index = 0

  const skipWhitespace = () => {
    while (expression[index] === ' ') {
      index += 1
    }
  }

  const parseNumber = () => {
    skipWhitespace()
    const start = index
    let seenDot = false

    while (index < expression.length) {
      const character = expression[index]
      if (character === '.') {
        if (seenDot) {
          break
        }
        seenDot = true
        index += 1
        continue
      }

      if (!isDigit(character)) {
        break
      }

      index += 1
    }

    if (start === index || (seenDot && start + 1 === index && expression[start] === '.')) {
      throw new Error('Expected number')
    }

    const value = Number(expression.slice(start, index))
    if (!Number.isFinite(value)) {
      throw new Error('Invalid number')
    }

    return value
  }

  const parseFactor = (): number => {
    skipWhitespace()
    const character = expression[index]

    if (character === '+') {
      index += 1
      return parseFactor()
    }

    if (character === '-') {
      index += 1
      return -parseFactor()
    }

    if (character === '(') {
      index += 1
      const value = parseExpression()
      skipWhitespace()
      if (expression[index] !== ')') {
        throw new Error('Missing closing parenthesis')
      }
      index += 1
      return value
    }

    return parseNumber()
  }

  const parseTerm = (): number => {
    let value = parseFactor()

    while (true) {
      skipWhitespace()
      const operator = expression[index]
      if (operator !== '*' && operator !== '/' && operator !== '%') {
        return value
      }

      index += 1
      const right = parseFactor()

      if (operator === '*') {
        value *= right
      } else if (operator === '/') {
        value /= right
      } else {
        value %= right
      }
    }
  }

  const parseExpression = (): number => {
    let value = parseTerm()

    while (true) {
      skipWhitespace()
      const operator = expression[index]
      if (operator !== '+' && operator !== '-') {
        return value
      }

      index += 1
      const right = parseTerm()
      value = operator === '+' ? value + right : value - right
    }
  }

  const result = parseExpression()
  skipWhitespace()

  if (index !== expression.length) {
    throw new Error('Unexpected trailing characters')
  }

  if (!Number.isFinite(result)) {
    throw new Error('Invalid result')
  }

  return result
}

const evaluateExpression = (rawQuery: string) => {
  const expression = normalizeExpression(rawQuery)

  if (!expression) {
    return { expression: '', result: '', error: '' }
  }

  if (!/^[\d+\-*/().,\s%]+$/.test(expression)) {
    return { expression, result: '', error: '只支持数字和 + - * / ( ) 这些运算符' }
  }

  const normalized = expression.replace(/,/g, '')

  try {
    const value = parseCalculation(normalized)

    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return { expression, result: '', error: '算式结果无效，请检查输入内容' }
    }

    return {
      expression,
      result: formatResult(value),
      error: '',
    }
  } catch {
    return { expression, result: '', error: '算式格式不正确，请继续调整' }
  }
}

export function CalculatorPanel({ query, trigger, setQuery }: CalculatorPanelProps) {
  const trimmedQuery = query.trim()
  const calculation = useMemo(() => evaluateExpression(trimmedQuery), [trimmedQuery])

  return (
    <div className="ms-command-stack">
      <div className="ms-command-chip">
        <span>{trigger}</span>
        <span className="ms-command-chip-muted">Calculator</span>
      </div>

      <section className={`ms-translate-command-card ${calculation.error ? 'is-error' : ''}`}>
        <div className="ms-translate-command-panel-head">
          <span className="ms-translate-command-panel-label">计算结果</span>
        </div>

        <div
          className={`ms-translate-command-panel-body ${!trimmedQuery ? 'is-placeholder' : calculation.error ? 'is-error' : ''}`}
        >
          {!trimmedQuery ? (
            `示例：${trigger} (12 + 8) * 3 / 2`
          ) : calculation.error ? (
            calculation.error
          ) : (
            <div className="ms-calculator-stack">
              <div className="ms-calculator-expression">{calculation.expression}</div>
              <button
                type="button"
                className="ms-calculator-result"
                onClick={() => setQuery(`${trigger} ${calculation.result}`)}
              >
                = {calculation.result}
              </button>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
