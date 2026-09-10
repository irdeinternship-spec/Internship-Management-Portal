function SearchBar({ value, onChange }) {
  return (
    <label className="admin-field admin-field--wide">
      <span>Search by Name, Application ID, Email, Phone, or College</span>
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Type a name, application ID, email, phone, or college"
      />
    </label>
  );
}

export default SearchBar;
