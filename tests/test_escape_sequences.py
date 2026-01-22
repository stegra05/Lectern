import unittest
import sys
import os

# Add project root to sys.path to allow imports if run directly
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from ai_schemas import _fix_escape_sequences, preprocess_fields_json_escapes

class TestFixEscapeSequences(unittest.TestCase):
    def test_latex_commands_starting_with_valid_escapes(self):
        """Test LaTeX commands that start with valid JSON escape characters."""
        inputs = [
            r"\theta is an angle",
            r"\beta is a parameter",
            r"\rho is density",
            r"\phi is a value",
            r"Line 1\newlineLine 2"
        ]
        
        expected = [
            r"\\theta is an angle",
            r"\\beta is a parameter",
            r"\\rho is density",
            r"\\phi is a value", # \p hits catch-all invalid escapes
            r"Line 1\\newlineLine 2"
        ]
        
        for inp, exp in zip(inputs, expected):
            with self.subTest(input=inp):
                self.assertEqual(_fix_escape_sequences(inp), exp)

    def test_invalid_unicode_escapes(self):
        r"""Test \u sequences that are not valid 4-digit hex codes."""
        inputs = [
            r"\unit is kg",
            r"\user input",
            r"C:\users\name",
            r"\u123 (short)",
            r"\uGGGG (invalid hex)"
        ]
        
        expected = [
            r"\\unit is kg",
            r"\\user input",
            r"C:\\users\\name",
            r"\\u123 (short)",
            r"\\uGGGG (invalid hex)"
        ]
        
        for inp, exp in zip(inputs, expected):
            with self.subTest(input=inp):
                self.assertEqual(_fix_escape_sequences(inp), exp)

    def test_already_escaped_backslashes(self):
        r"""Test that \ is not turned into \\ (double escaping)."""
        inputs = [
            r"\\theta is escaped",
            r"\\alpha is escaped",
            r"This is a backslash: \\",
            r"C:\\Windows\\System32"
        ]
        
        expected = inputs
        
        for inp, exp in zip(inputs, expected):
            with self.subTest(input=inp):
                self.assertEqual(_fix_escape_sequences(inp), exp)

    def test_valid_json_escapes(self):
        """Test that valid JSON escapes are NOT modified."""
        inputs = [
            r"Line 1\n Line 2",
            r"Col1\t 123",
            r"He said \"Hello\"",
            r"\u03A9 is Omega"
        ]
        
        expected = inputs
        
        for inp, exp in zip(inputs, expected):
            with self.subTest(input=inp):
                self.assertEqual(_fix_escape_sequences(inp), exp)

    def test_general_invalid_escapes(self):
        r"""Test general invalid escapes like \alpha, \sigma."""
        inputs = [
            r"\alpha",
            r"\sigma",
            r"\(x\)",
            r"\{ \}"
        ]
        
        expected = [
            r"\\alpha",
            r"\\sigma",
            r"\\(x\\)",
            r"\\{ \\}"
        ]
        
        for inp, exp in zip(inputs, expected):
            with self.subTest(input=inp):
                self.assertEqual(_fix_escape_sequences(inp), exp)


class TestPreprocessFieldsJsonEscapes(unittest.TestCase):
    def test_preprocess_fields_json(self):
        """Test that it correctly identifies and fixes fields inside JSON string."""
        raw_json = r'{"fields_json": "{\"Front\": \"Formula: \theta\", \"Back\": \beta\"}", "reflection": "I used \rho"}'
        expected = r'{"fields_json": "{\"Front\": \"Formula: \\theta\", \"Back\": \\beta\"}", "reflection": "I used \\rho"}'
        
        processed = preprocess_fields_json_escapes(raw_json)
        self.assertEqual(processed, expected)

    def test_preprocess_ignores_other_fields(self):
        """Test that it doesn't mess with fields not in the target list (unless global fallback hits)."""
        raw_json = r'{"other": "\theta"}' 
        # \theta inside "other" is just tab+heta. Valid JSON. Should not change.
        self.assertEqual(preprocess_fields_json_escapes(raw_json), raw_json)

    def test_preprocess_global_fallback(self):
        """Test the global fallback for obvious invalid escapes outside target fields."""
        raw_json = r'{"other": "Value with \. and \#"}'
        expected = r'{"other": "Value with \\. and \\#"}'
        self.assertEqual(preprocess_fields_json_escapes(raw_json), expected)

    def test_preprocess_new_fields(self):
        """Test that new fields (definition, name, slide_topic) are processed."""
        # slide_topic
        raw = r'{"slide_topic": "Topic \theta"}'
        expected = r'{"slide_topic": "Topic \\theta"}'
        self.assertEqual(preprocess_fields_json_escapes(raw), expected)

        # definition
        raw = r'{"definition": "Def \rho"}'
        expected = r'{"definition": "Def \\rho"}'
        self.assertEqual(preprocess_fields_json_escapes(raw), expected)

        # name
        raw = r'{"name": "Name \phi"}'
        expected = r'{"name": "Name \\phi"}'
        self.assertEqual(preprocess_fields_json_escapes(raw), expected)

if __name__ == '__main__':
    unittest.main()