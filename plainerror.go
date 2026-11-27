package main

import "strings"

// plainError says what went wrong during setup in words for someone who
// isn't a developer, with what to do about it. The original text still
// goes to the setup log, for whoever needs the details.
func plainError(err error) string {
	s := err.Error()
	has := func(subs ...string) bool {
		for _, sub := range subs {
			if strings.Contains(s, sub) {
				return true
			}
		}
		return false
	}
	switch {
	case has("unable to authenticate", "no supported methods remain"):
		return "The computer didn't accept this Mac's SSH key. Check the user name, and that this Mac's key is in that user's ~/.ssh/authorized_keys there."
	case has("connection refused"):
		return "Nothing answered on that address. Check the computer is on and that SSH (Remote Login on a Mac) is turned on."
	case has("no such host"):
		return "There's no computer with that name. Check the address."
	case has("i/o timeout", "no route to host", "network is unreachable", "host is down"):
		return "Couldn't reach that address. Check it's right and that this Mac can reach that computer's network."
	case has("sudo refused", "incorrect password", "Sorry, try again"):
		return "The sudo password wasn't accepted on that computer."
	case has("sudo needs a password"):
		return "That computer asks for a sudo password: enter it under Advanced. It's used once and never stored."
	case has("no space left on device"):
		return "That computer ran out of disk space. Free some space, then try again."
	case has("context deadline exceeded"):
		return "Setup took too long and stopped. Running it again picks up where it left off."
	}
	return s
}
