
import pytest
from unittest.mock import MagicMock, patch
import json
from utils.tags import infer_slide_set_name_with_ai

class TestAINaming:
    @pytest.fixture
    def mock_genai_client(self):
        # Patch google.genai.Client directly.
        # Since the function imports it from google.genai, this should work.
        with patch("google.genai.Client") as mock_client:
            yield mock_client

    # Mocking config variables directly
    @pytest.fixture
    def mock_config(self):
        with patch("config.GEMINI_API_KEY", "fake_key"), \
             patch("config.LIGHTWEIGHT_MODEL", "gemini-3-flash-preview"):
            yield

    def test_infer_slide_set_name_with_ai_success(self, mock_genai_client, mock_config):
        # Setup mock response
        mock_response = MagicMock()
        mock_response.text = json.dumps({"name": "Lecture 2 Supervised Learning"})

        mock_client_instance = mock_genai_client.return_value
        mock_client_instance.models.generate_content.return_value = mock_response

        # Call function
        result = infer_slide_set_name_with_ai(
            pdf_filename="lecture2_slides.pdf",
            pdf_title="Week 2",
            first_slides_text=["Slide 1", "Slide 2"]
        )

        # Verify
        assert result == "Lecture 2 Supervised Learning"
        mock_client_instance.models.generate_content.assert_called_once()

        # Check that arguments to generate_content were correct
        args, kwargs = mock_client_instance.models.generate_content.call_args
        assert kwargs['model'] == "gemini-3-flash-preview"
        assert "CONTEXT:" in kwargs['contents']
        assert "FIRST SLIDES CONTENT:" in kwargs['contents']

    def test_infer_slide_set_name_with_ai_api_error_fallback(self, mock_genai_client, mock_config):
        # Setup mock to raise exception
        mock_client_instance = mock_genai_client.return_value
        mock_client_instance.models.generate_content.side_effect = Exception("API Error")

        # Call function (should fall back to heuristic)
        # We provide an empty title so heuristic falls back to filename
        result = infer_slide_set_name_with_ai(
            pdf_filename="Lecture_05_Neural_Networks",
            pdf_title="",
            first_slides_text=["Slide 1"]
        )

        # Heuristic should pick up "Lecture 05 Neural Networks"
        assert result == "Lecture 05 Neural Networks"

    def test_infer_slide_set_name_with_ai_invalid_json_fallback(self, mock_genai_client, mock_config):
        # Setup mock response with bad JSON
        mock_response = MagicMock()
        mock_response.text = "Not JSON"

        mock_client_instance = mock_genai_client.return_value
        mock_client_instance.models.generate_content.return_value = mock_response

        result = infer_slide_set_name_with_ai(
            pdf_filename="Lecture_05_Neural_Networks",
            pdf_title="",
            first_slides_text=["Slide 1"]
        )

        assert result == "Lecture 05 Neural Networks"

    def test_infer_slide_set_name_with_ai_validation_failure_fallback(self, mock_genai_client, mock_config):
        # Setup mock response with invalid name (too short)
        mock_response = MagicMock()
        mock_response.text = json.dumps({"name": "Hi"})

        mock_client_instance = mock_genai_client.return_value
        mock_client_instance.models.generate_content.return_value = mock_response

        result = infer_slide_set_name_with_ai(
            pdf_filename="Lecture_05_Neural_Networks",
            pdf_title="",
            first_slides_text=["Slide 1"]
        )

        assert result == "Lecture 05 Neural Networks"

    def test_infer_slide_set_name_with_ai_no_api_key(self, mock_genai_client):
        # Explicitly patch API KEY to empty
        with patch("config.GEMINI_API_KEY", ""):
            result = infer_slide_set_name_with_ai(
                pdf_filename="Lecture_05_Neural_Networks",
                pdf_title="",
                first_slides_text=["Slide 1"]
            )

            # Should fall back
            assert result == "Lecture 05 Neural Networks"

            # Should verify Client was NOT initialized
            mock_genai_client.assert_not_called()

    def test_infer_slide_set_name_with_ai_empty_slides(self, mock_genai_client, mock_config):
        # Setup mock response
        mock_response = MagicMock()
        mock_response.text = json.dumps({"name": "Week 1 Introduction"})

        mock_client_instance = mock_genai_client.return_value
        mock_client_instance.models.generate_content.return_value = mock_response

        # Call function with empty slides (e.g. images only)
        result = infer_slide_set_name_with_ai(
            pdf_filename="Week1_Intro.pdf",
            pdf_title="Week 1",
            first_slides_text=["  ", "", "\n"]
        )

        assert result == "Week 1 Introduction"

        # Verify prompt contains the fallback message
        args, kwargs = mock_client_instance.models.generate_content.call_args
        assert "(No text content available from first slides)" in kwargs['contents']
