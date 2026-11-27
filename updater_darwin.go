package main

/*
#cgo CFLAGS: -x objective-c -fobjc-arc
#cgo LDFLAGS: -framework Cocoa
#import <Cocoa/Cocoa.h>

// Sparkle installs updates. A release build carries Sparkle.framework in
// Contents/Frameworks (scripts/fetch-sparkle.sh); it is loaded here at run
// time rather than linked, so a development build without it still runs.
// The feed and the key that update archives must be signed with are in
// Info.plist (SUFeedURL, SUPublicEDKey).

@protocol TSUpdater <NSObject>
@property BOOL automaticallyChecksForUpdates;
@property BOOL automaticallyDownloadsUpdates;
- (BOOL)startUpdater:(NSError **)error;
@end

@protocol TSUpdaterController <NSObject>
- (instancetype)initWithStartingUpdater:(BOOL)start updaterDelegate:(id)u userDriverDelegate:(id)d;
@property (readonly) id<TSUpdater> updater;
- (void)checkForUpdates:(id)sender;
@end

static id<TSUpdaterController> tsController;
static char tsStatus[256] = "not started";

// Loads the framework; 1 when it's there. The updater itself starts on the
// main thread, with the checks set the way the person chose.
static int tsSparkleStart(int checks, int install) {
	NSString *path = [[[NSBundle mainBundle] privateFrameworksPath] stringByAppendingPathComponent:@"Sparkle.framework"];
	NSBundle *b = [NSBundle bundleWithPath:path];
	NSError *err = nil;
	if (b == nil || ![b loadAndReturnError:&err]) return 0;
	Class c = NSClassFromString(@"SPUStandardUpdaterController");
	if (c == nil) return 0;
	dispatch_async(dispatch_get_main_queue(), ^{
		// Started by hand rather than by the controller, so a failure
		// lands in the app's log instead of only in an alert.
		tsController = [(id<TSUpdaterController>)[c alloc] initWithStartingUpdater:NO updaterDelegate:nil userDriverDelegate:nil];
		id<TSUpdater> u = tsController.updater;
		NSError *serr = nil;
		if (![u startUpdater:&serr]) {
			snprintf(tsStatus, sizeof tsStatus, "failed to start: %s", serr.localizedDescription.UTF8String ?: "unknown error");
			return;
		}
		u.automaticallyChecksForUpdates = checks != 0;
		u.automaticallyDownloadsUpdates = checks != 0 && install != 0;
		snprintf(tsStatus, sizeof tsStatus, "running, checks=%d install=%d, feed %s",
			u.automaticallyChecksForUpdates, u.automaticallyDownloadsUpdates,
			[[[(id)u valueForKey:@"feedURL"] absoluteString] UTF8String] ?: "none");
	});
	return 1;
}

static void tsSparkleSet(int checks, int install) {
	dispatch_async(dispatch_get_main_queue(), ^{
		if (tsController == nil) return;
		tsController.updater.automaticallyChecksForUpdates = checks != 0;
		tsController.updater.automaticallyDownloadsUpdates = checks != 0 && install != 0;
	});
}

static const char *tsSparkleStatus(void) { return tsStatus; }

// Opens Sparkle's own window: checking, then what's new and Install.
static void tsSparkleCheck(void) {
	dispatch_async(dispatch_get_main_queue(), ^{
		[NSApp activateIgnoringOtherApps:YES];
		[tsController checkForUpdates:nil];
	});
}
*/
import "C"

import (
	"log"
	"time"
)

// sparkle is true once Sparkle is running; then it does the checking and
// installing, and the window's own notice stays quiet.
var sparkle bool

func cbool(b bool) C.int {
	if b {
		return 1
	}
	return 0
}

func startUpdater(s Settings) {
	sparkle = C.tsSparkleStart(cbool(s.CheckUpdates), cbool(s.AutoUpdate)) != 0
	log.Printf("updater: sparkle=%v", sparkle)
	if sparkle {
		go func() {
			time.Sleep(5 * time.Second)
			log.Printf("updater: %s", C.GoString(C.tsSparkleStatus()))
		}()
	}
}

func applyUpdater(s Settings) {
	if sparkle {
		C.tsSparkleSet(cbool(s.CheckUpdates), cbool(s.AutoUpdate))
	}
}

// CheckForUpdates opens Sparkle's update window. Without Sparkle (a
// development build) it reports false and the window says so.
func (a *App) CheckForUpdates() bool {
	if !sparkle {
		return false
	}
	C.tsSparkleCheck()
	return true
}

// Updater says whether this build installs its own updates.
func (a *App) Updater() bool { return sparkle }
