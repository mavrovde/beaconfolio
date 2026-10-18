from unittest.mock import patch

from app.services.slugs import slug_suffix


def test_slug_suffix_is_four_digits_from_the_csprng():
    """The suffix spans 1000-9999 and is drawn from `secrets`, not `random`."""
    with patch("app.services.slugs.secrets.randbelow", side_effect=[0, 8999]) as rb:
        assert slug_suffix() == "1000"
        assert slug_suffix() == "9999"
    rb.assert_called_with(9000)
    for _ in range(50):
        value = slug_suffix()
        assert len(value) == 4 and 1000 <= int(value) <= 9999
