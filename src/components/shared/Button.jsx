function Button({ children, variant = 'primary', full = false, disabled = false, onClick, type = 'button' }) {
  const classes = [
    'btn',
    `btn--${variant}`,
    full ? 'btn--full' : '',
  ].filter(Boolean).join(' ')

  return (
    <button type={type} className={classes} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  )
}

export default Button
