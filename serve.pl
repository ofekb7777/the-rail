#!/usr/bin/perl
# Tiny static file server. No installs needed -- uses the Perl that ships
# with Git for Windows.
#
#   perl serve.pl            # http://localhost:8000
#   perl serve.pl 3000       # pick another port
#
# Serving over http://localhost matters for more than convenience: browsers
# treat it as a secure origin, so geolocation (the weather lookup) and
# service workers work here but not from a file:// path.

use strict;
use warnings;
use HTTP::Daemon;
use HTTP::Status;
use File::Spec;
use Cwd qw(abs_path);

my $port = $ARGV[0] || 8000;
my $root = abs_path('.');

my %MIME = (
  html => 'text/html; charset=utf-8',
  htm  => 'text/html; charset=utf-8',
  js   => 'text/javascript; charset=utf-8',
  css  => 'text/css; charset=utf-8',
  json => 'application/json; charset=utf-8',
  svg  => 'image/svg+xml',
  png  => 'image/png',
  jpg  => 'image/jpeg',
  jpeg => 'image/jpeg',
  gif  => 'image/gif',
  webp => 'image/webp',
  ico  => 'image/x-icon',
  woff => 'font/woff',
  woff2=> 'font/woff2',
  txt  => 'text/plain; charset=utf-8',
  md   => 'text/plain; charset=utf-8',
);

# Binding 0.0.0.0 (so a phone on the same Wi-Fi can reach us) makes
# HTTP::Daemon warn while assembling its own URL. Harmless, but it buries the
# request log, so drop just those.
$SIG{__WARN__} = sub {
  my $m = shift;
  return if $m =~ /uninitialized value \$(host|port)/;
  warn $m;
};

my $d = HTTP::Daemon->new(
  LocalAddr => '0.0.0.0',
  LocalPort => $port,
  ReuseAddr => 1,
  Timeout   => 5,
) or die "Could not bind port $port: $!\n"
       . "Something else may already be using it -- try: perl serve.pl 8080\n";

print "\n  Serving $root\n";
print "  ->  http://localhost:$port/\n";
print "\n  On your phone: connect to the same Wi-Fi, then find this PC's\n";
print "  local IP (ipconfig) and open http://<that-ip>:$port/\n";
print "\n  Ctrl+C to stop.\n\n";

# Handled serially, one request per connection. That is fast enough for a
# single static file, and it sidesteps the two ways this loop can wedge:
# keep-alive parking a worker on an idle tab (solved by Connection: close),
# and accept() returning undef on timeout -- which must be retried, not
# treated as end-of-loop, or the server quietly exits after one request.
while (1) {
  my $c = $d->accept or next;
  eval { handle($c); 1 } or print "  !!   $@";
  $c->close;
  undef $c;
}

sub handle {
  my ($conn) = @_;
  my $r = $conn->get_request or return;

  if ($r->method ne 'GET' && $r->method ne 'HEAD') {
    $conn->send_error(RC_METHOD_NOT_ALLOWED);
    return;
  }

  my $path = $r->uri->path;
  $path = '/index.html' if $path eq '/';

  # URL-decode, then reject anything that escapes the served directory.
  $path =~ s/%([0-9A-Fa-f]{2})/chr(hex($1))/ge;
  my $file = abs_path(File::Spec->catfile($root, split m{/}, $path));

  if (!defined $file || index($file, $root) != 0 || !-f $file) {
    $conn->send_error(RC_NOT_FOUND);
    printf "  404  %s\n", $path;
    return;
  }

  my ($ext) = $file =~ /\.([^.]+)$/;
  my $type = $MIME{lc($ext || '')} || 'application/octet-stream';

  my $res = HTTP::Response->new(RC_OK);
  $res->header('Content-Type'  => $type);
  # The app is edited in place; never let the browser serve a stale copy.
  $res->header('Cache-Control' => 'no-store');
  $res->header('Connection'    => 'close');

  if ($r->method eq 'GET') {
    open my $fh, '<:raw', $file or do { $conn->send_error(RC_FORBIDDEN); return; };
    local $/;
    $res->content(<$fh>);
    close $fh;
  }

  $conn->force_last_request;
  $conn->send_response($res);
  printf "  200  %s\n", $path;
}
