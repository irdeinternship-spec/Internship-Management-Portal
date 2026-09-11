import { useEffect, useMemo, useRef, useState } from "react";

function SearchableDropdown({
  label,
  name,
  value,
  onChange,
  options,
  error,
  required = false,
  placeholder = "Search and select",
  disabled = false,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const fieldRef = useRef(null);
  const filteredOptions = useMemo(() => {
    const query = value.trim().toLowerCase();

    const nextFilteredOptions = !query
      ? [...options].sort((a, b) => a.localeCompare(b))
      : [...options]
          .map((option) => {
            const lower = option.toLowerCase();

            let score;

            // Exact match
            if (lower === query) score = 0;

            // Starts with query
            else if (lower.startsWith(query)) score = 1;

            // Any word starts with query
            else {
              const words = lower.split(/[\s,-]+/);

              const index = words.findIndex((word) => word.startsWith(query));

              if (index !== -1) {
                score = 10 + index;
              } else {
                const pos = lower.indexOf(query);

                if (pos !== -1) {
                  score = 100 + pos;
                } else {
                  return null;
                }
              }
            }

            return { option, score };
          })
          .filter(Boolean)
          .sort((a, b) => {
            if (a.score !== b.score) return a.score - b.score;
            return a.option.localeCompare(b.option);
          })
          .map((item) => item.option);

    return nextFilteredOptions;
  }, [options, value]);

  useEffect(() => {
    function handleDocumentClick(event) {
      if (!fieldRef.current?.contains(event.target)) {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handleDocumentClick);

    return () => {
      document.removeEventListener("mousedown", handleDocumentClick);
    };
  }, []);

  const updateValue = (nextValue) => {
    onChange({
      target: {
        name,
        value: nextValue,
        type: "text",
      },
    });
  };

  const handleInputChange = (event) => {
    updateValue(event.target.value);
    setIsOpen(true);
  };

  const handleSelect = (option) => {
    updateValue(option);
    setIsOpen(false);
  };

  return (
    <div
      className={`field searchable-field ${error ? "field--error" : ""}`}
      ref={fieldRef}
    >
      <label className="searchable-field__label" htmlFor={name}>
        {label}
      </label>

      <input
        id={name}
        className="field__control searchable-field__control"
        type="text"
        name={name}
        value={value}
        onChange={handleInputChange}
        onFocus={() => !disabled && setIsOpen(true)}
        onClick={() => !disabled && setIsOpen(true)}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        autoComplete="off"
        role="combobox"
        aria-expanded={isOpen}
        aria-controls={`${name}-options`}
        aria-autocomplete="list"
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${name}-error` : undefined}
      />

      {isOpen && (
        <div
          className="searchable-field__menu"
          id={`${name}-options`}
          role="listbox"
        >
          {filteredOptions.length > 0 ? (
            filteredOptions.map((option, index) => (
              <button
                key={`${option}-${index}`}
                type="button"
                className="searchable-field__option"
                role="option"
                aria-selected={option === value}
                onClick={() => handleSelect(option)}
              >
                {option}
              </button>
            ))
          ) : (
            <span className="searchable-field__empty">
              No matching options found.
            </span>
          )}
        </div>
      )}

      {error && (
        <span className="field__error" id={`${name}-error`}>
          {error}
        </span>
      )}
    </div>
  );
}

export default SearchableDropdown;
